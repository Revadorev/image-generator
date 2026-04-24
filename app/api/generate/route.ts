import { NextRequest, NextResponse } from "next/server";
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ImageRequest {
  prompts: string[];
  referenceImage?: string; // base64
}

// Analizează imaginea de referință cu GPT-4 Vision
async function analyzeReferenceImage(base64Image: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Analyze this product image in extreme detail. Describe: exact colors (hex codes if possible), materials, textures, lighting setup, composition, background style, product positioning, shadows, reflections, and any text/branding visible. Be technical and precise.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
            },
          },
        ],
      },
    ],
    max_tokens: 500,
  });

  return response.choices[0].message.content || "";
}

// Agent AI care combină analiza imaginii cu promptul utilizatorului
async function createOptimizedPrompt(
  userPrompt: string,
  imageAnalysis: string
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are an expert prompt engineer for image generation. Your job is to combine the user's request with the visual analysis of a reference image to create the perfect prompt for gpt-image-1. Be specific about style, colors, composition, and technical details. Keep the prompt under 1000 characters.",
      },
      {
        role: "user",
        content: `User request: ${userPrompt}\n\nReference image analysis: ${imageAnalysis}\n\nCreate an optimized prompt that combines both, maintaining the visual style of the reference while fulfilling the user's request.`,
      },
    ],
    max_tokens: 400,
  });

  return response.choices[0].message.content || userPrompt;
}

export async function POST(req: NextRequest) {
  try {
    const body: ImageRequest = await req.json();
    const { prompts, referenceImage } = body;

    if (!prompts || prompts.length === 0) {
      return NextResponse.json(
        { error: "Nu au fost trimise prompturi" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY nu este configurat" },
        { status: 500 }
      );
    }

    // Analizează imaginea de referință dacă există
    let imageAnalysis = "";
    if (referenceImage) {
      try {
        console.log("Analyzing reference image with GPT-4 Vision...");
        imageAnalysis = await analyzeReferenceImage(referenceImage);
        console.log("Image analysis:", imageAnalysis);
      } catch (error) {
        console.error("Error analyzing reference image:", error);
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const generatePromise = prompts.map(async (prompt, index) => {
            const imageId = `${Date.now()}-${index}`;

            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    id: imageId,
                    status: "generating",
                    prompt,
                  })}\n`
                )
              );

              // Îmbunătățește promptul cu AI Agent
              let enhancedPrompt = prompt;
              if (imageAnalysis) {
                console.log("Creating optimized prompt with AI Agent...");
                enhancedPrompt = await createOptimizedPrompt(prompt, imageAnalysis);
                console.log("Optimized prompt:", enhancedPrompt);
              }

              const response = await openai.images.generate({
                model: "gpt-image-1",
                prompt: enhancedPrompt,
                size: "1024x1024",
                quality: "standard",
                n: 1,
              });

              const imageUrl = response.data?.[0]?.url;

              if (imageUrl) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      id: imageId,
                      status: "done",
                      url: imageUrl,
                      prompt,
                    })}\n`
                  )
                );
              }
            } catch (error: any) {
              const errorMsg =
                error?.error?.message || error?.message || "Eroare necunoscută";
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    id: imageId,
                    status: "error",
                    error: errorMsg,
                    prompt,
                  })}\n`
                )
              );
            }
          });

          await Promise.all(generatePromise);
          controller.close();
        } catch (error) {
          console.error("Stream error:", error);
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Eroare la procesare",
      },
      { status: 500 }
    );
  }
}
