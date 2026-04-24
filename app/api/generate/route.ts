import { NextRequest, NextResponse } from "next/server";
import { OpenAI } from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

interface ImageRequest {
  prompts: string[];
  referenceImage?: string;
  variantsCount?: number;
  sessionId?: string; // pentru memorie
}

interface ConversationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const ECOMMERCE_SYSTEM_PROMPT = `You are a senior ecommerce designer specialized in marketplace images (eMAG style).

Your job is to transform basic product data into a HIGH-CONVERTING image generation prompt.

Rules:
- Keep product design EXACT (no shape/color changes)
- Romanian text only
- Clean commercial layout
- No logos, no fake badges
- High contrast, marketplace ready
- Clear visual hierarchy

Output only the final prompt.`;

// Încarcă conversația din memorie
async function loadConversationHistory(sessionId: string): Promise<ConversationMessage[]> {
  try {
    const { data, error } = await supabase
      .from("image_generator_conversations")
      .select("messages")
      .eq("session_id", sessionId)
      .single();

    if (error || !data) {
      return [{ role: "system", content: ECOMMERCE_SYSTEM_PROMPT }];
    }

    return data.messages || [{ role: "system", content: ECOMMERCE_SYSTEM_PROMPT }];
  } catch (e) {
    console.error("Error loading conversation:", e);
    return [{ role: "system", content: ECOMMERCE_SYSTEM_PROMPT }];
  }
}

// Salvează conversația în memorie
async function saveConversationHistory(
  sessionId: string,
  messages: ConversationMessage[]
): Promise<void> {
  try {
    await supabase
      .from("image_generator_conversations")
      .upsert({
        session_id: sessionId,
        messages: messages,
        updated_at: new Date().toISOString(),
      });
  } catch (e) {
    console.error("Error saving conversation:", e);
  }
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
    max_completion_tokens: 500,
  });

  return response.choices[0].message.content || "";
}

// Agent AI cu memorie care generează multiple variante de prompturi
async function generatePromptVariants(
  userRequest: string,
  imageAnalysis: string,
  count: number,
  sessionId: string
): Promise<string[]> {
  // Încarcă conversația anterioară
  const conversationHistory = await loadConversationHistory(sessionId);

  // Adaugă cererea curentă
  conversationHistory.push({
    role: "user",
    content: `User request: ${userRequest}\n\nReference image analysis: ${imageAnalysis}\n\nGenerate ${count} creative prompt variations that maintain the visual style from the analysis. Remember our previous conversations and preferences. Return a JSON object with a "prompts" array.`,
  });

  const response = await openai.chat.completions.create({
    model: "gpt-5.3-chat-latest", // Cel mai avansat model GPT-5
    messages: conversationHistory as any,
    max_completion_tokens: 1500,
    response_format: { type: "json_object" },
  });

  const assistantMessage = response.choices[0].message.content || "{}";

  // Salvează răspunsul în conversație
  conversationHistory.push({
    role: "assistant",
    content: assistantMessage,
  });

  await saveConversationHistory(sessionId, conversationHistory);

  try {
    const result = JSON.parse(assistantMessage);
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
    const { prompts, referenceImage, variantsCount = 4, sessionId = "default" } = body;

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

            // Dacă avem imagine de referință, generează variante automat cu memorie
            if (imageAnalysis) {
              console.log(`Generating ${variantsCount} variants for: "${userPrompt}"`);
              promptsToGenerate = await generatePromptVariants(
                userPrompt,
                imageAnalysis,
                variantsCount,
                sessionId
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
