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
            text: "Analyze this product image and describe it in detail for DALL-E 3 generation. Focus on: style, colors, composition, lighting, background, and key visual elements. Be specific and descriptive.",
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
    max_tokens: 300,
  });

  return response.choices[0].message.content || "";
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

              // Îmbunătățește promptul cu analiza imaginii de referință
              let enhancedPrompt = prompt;
              if (imageAnalysis) {
                enhancedPrompt = `${prompt}. Style and visual reference: ${imageAnalysis}`;
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
