import { NextRequest, NextResponse } from "next/server";
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ImageRequest {
  prompts: string[];
  referenceImage?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: ImageRequest = await req.json();
    const { prompts } = body;

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

              const response = await openai.images.generate({
                model: "dall-e-3",
                prompt: prompt,
                size: "1024x1024",
                quality: "standard",
                n: 1,
              });

              const imageUrl = response.data[0].url;

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
