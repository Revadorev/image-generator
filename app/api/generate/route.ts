import { NextRequest, NextResponse } from "next/server";
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ImageRequest {
  prompts: string[];
  referenceImage?: string; // base64
  variantsCount?: number; // câte variante să genereze AI-ul
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

// Agent AI care generează multiple variante de prompturi
async function generatePromptVariants(
  userRequest: string,
  imageAnalysis: string,
  count: number = 4
): Promise<string[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          `You are an expert prompt engineer for image generation. Generate exactly ${count} different creative prompt variations based on the user's request and reference image analysis. Each prompt should be unique and explore different angles, compositions, or styles while maintaining the core request. Return a JSON object with a "prompts" array containing the ${count} variations.`,
      },
      {
        role: "user",
        content: `User request: ${userRequest}\n\nReference image analysis: ${imageAnalysis}\n\nGenerate ${count} creative prompt variations that maintain the visual style from the analysis.`,
      },
    ],
    max_tokens: 1500,
    response_format: { type: "json_object" },
  });

  try {
    const result = JSON.parse(response.choices[0].message.content || "{}");
    const variants = result.prompts || [];
    console.log(`Generated ${variants.length} prompt variants:`, variants);
    return variants.length > 0 ? variants : [userRequest];
  } catch (e) {
    console.error("Error parsing prompt variants:", e);
    return [userRequest];
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: ImageRequest = await req.json();
    const { prompts, referenceImage, variantsCount = 4 } = body;

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
          // Pentru fiecare prompt de la user, generează variante
          for (const userPrompt of prompts) {
            let promptsToGenerate = [userPrompt];

            // Dacă avem imagine de referință, generează variante automat
            if (imageAnalysis) {
              console.log(`Generating ${variantsCount} variants for: "${userPrompt}"`);
              promptsToGenerate = await generatePromptVariants(
                userPrompt,
                imageAnalysis,
                variantsCount
              );
            }

            // Generează imagini pentru toate variantele
            const generatePromises = promptsToGenerate.map(async (prompt, index) => {
              const imageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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

                const response = await openai.images.generate({
                  model: "gpt-image-1",
                  prompt: prompt,
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

            await Promise.all(generatePromises);
          }

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
