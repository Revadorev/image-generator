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

interface PromptTemplate {
  key: string;
  label: string;
  value: string;
  enabled: boolean;
}

interface PromptRequest {
  userRequest: string;
  referenceImage?: string;
  variantsCount?: number;
  sessionId?: string;
  templates?: PromptTemplate[];
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

interface ConversationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

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
    return [{ role: "system", content: ECOMMERCE_SYSTEM_PROMPT }];
  }
}

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
    console.log("Error saving conversation:", e);
  }
}

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

async function generatePromptVariants(
  userRequest: string,
  imageAnalysis: string,
  count: number,
  sessionId: string,
  templates: PromptTemplate[] = []
): Promise<string[]> {
  const conversationHistory = await loadConversationHistory(sessionId);

  const templateText = templates.length
    ? `\n\nAvailable image types and base prompts:\n${templates
        .map((template) => `- ${template.label}: ${template.value}`)
        .join("\n")}`
    : "";

  conversationHistory.push({
    role: "user",
    content: `User request: ${userRequest}\n\nReference image analysis: ${imageAnalysis}${templateText}\n\nGenerate ${count} creative prompt variations that maintain the visual style from the analysis and match the selected image types. Remember our previous conversations and preferences. Return a JSON object with a "prompts" array.`,
  });

  const response = await openai.chat.completions.create({
    model: "gpt-5.3-chat-latest",
    messages: conversationHistory as any,
    max_completion_tokens: 1500,
    response_format: { type: "json_object" },
  });

  const assistantMessage = response.choices[0].message.content || "{}";

  conversationHistory.push({
    role: "assistant",
    content: assistantMessage,
  });

  await saveConversationHistory(sessionId, conversationHistory);

  try {
    const result = JSON.parse(assistantMessage);
    return result.prompts || [userRequest];
  } catch (e) {
    return [userRequest];
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: PromptRequest = await req.json();
    const { userRequest, referenceImage, variantsCount = 4, sessionId = "default", templates = [] } = body;

    if (!userRequest) {
      return NextResponse.json(
        { error: "Nu a fost trimis un prompt" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY nu este configurat" },
        { status: 500 }
      );
    }

    let imageAnalysis = "";
    if (referenceImage) {
      imageAnalysis = await analyzeReferenceImage(referenceImage);
    }

    const prompts = await generatePromptVariants(
      userRequest,
      imageAnalysis,
      variantsCount,
      sessionId,
      templates
    );

    return NextResponse.json({ prompts });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Eroare la procesare",
      },
      { status: 500 }
    );
  }
}
