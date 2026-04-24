"use client";

import { useState, useRef } from "react";
import { Loader2, Plus, Trash2, Image, Download, AlertCircle, Check } from "lucide-react";

interface GeneratedImage {
  id: string;
  prompt: string;
  url: string;
  status: "pending" | "generating" | "done" | "error";
  error?: string;
}

interface PromptTemplate {
  key: string;
  label: string;
  value: string;
}

const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    key: "main",
    label: "MAIN",
    value: "White background, product centered, no text, clean shadow",
  },
  {
    key: "infographic",
    label: "INFOGRAPHIC",
    value: "Icons + Romanian labels, highlight features visually",
  },
  {
    key: "lifestyle",
    label: "LIFESTYLE",
    value: "Child using product in real environment (bedroom, school)",
  },
  {
    key: "benefits",
    label: "BENEFITS",
    value: "Focus on emotional benefits (safety, communication)",
  },
  {
    key: "specs",
    label: "SPECS",
    value: "Dimensions, technical specs, structured layout",
  },
  {
    key: "premium",
    label: "PREMIUM",
    value: "Dark or gradient background, luxury lighting",
  },
];

const promptTemplateMap = DEFAULT_TEMPLATES.reduce<Record<string, string>>((accumulator, template) => {
  accumulator[template.key] = template.value;
  return accumulator;
}, {});

export default function Home() {
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [prompts, setPrompts] = useState<string[]>(["", "", "", ""]);
  const [promptTypes, setPromptTypes] = useState<string[]>(["main", "infographic", "lifestyle", "benefits"]);
  const [variantsCount, setVariantsCount] = useState<number>(4);
  const [generatedPrompts, setGeneratedPrompts] = useState<string[]>([]);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddPrompt = () => {
    setPrompts([...prompts, ""]);
    setPromptTypes([...promptTypes, "main"]);
  };

  const handleRemovePrompt = (index: number) => {
    setPrompts(prompts.filter((_, i) => i !== index));
    setPromptTypes(promptTypes.filter((_, i) => i !== index));
  };

  const handlePromptChange = (index: number, value: string) => {
    const newPrompts = [...prompts];
    newPrompts[index] = value;
    setPrompts(newPrompts);
  };

  const handlePromptTypeChange = (index: number, value: string) => {
    const next = [...promptTypes];
    next[index] = value;
    const templateValue = promptTemplateMap[value] || "";
    const nextPrompts = [...prompts];
    if (!nextPrompts[index].trim()) {
      nextPrompts[index] = templateValue;
    }
    setPromptTypes(next);
    setPrompts(nextPrompts);
  };

  const handleReferenceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setReferenceImage(e.target.files[0]);
    }
  };

  // Pas 1: Generează prompturile cu AI Agent
  const handleGeneratePrompts = async () => {
    const validPrompts = prompts.filter((p) => p.trim());
    if (validPrompts.length === 0) {
      setError("Adaugă cel puțin un prompt!");
      return;
    }

    if (!referenceImage) {
      setError("Adaugă o imagine de referință!");
      return;
    }

    const enabledTemplates = DEFAULT_TEMPLATES.filter((template) => promptTypes.includes(template.key));
    if (enabledTemplates.length === 0) {
      setError("Alege cel puțin un tip de imagine!");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/generate-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userRequest: validPrompts[0],
          referenceImage: await fileToBase64(referenceImage),
          variantsCount: variantsCount,
          sessionId: "default",
          templates: enabledTemplates,
        }),
      });

      if (!response.ok) {
        throw new Error("Eroare la generare prompturi");
      }

      const data = await response.json();
      setGeneratedPrompts(data.prompts || []);
      setShowPromptPreview(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare necunoscută");
    } finally {
      setLoading(false);
    }
  };

  // Pas 2: Generează imaginile cu prompturile editate
  const handleGenerate = async () => {
    const promptsToUse = showPromptPreview ? generatedPrompts : prompts.filter((p) => p.trim());
    
    if (promptsToUse.length === 0) {
      setError("Adaugă cel puțin un prompt!");
      return;
    }

    console.log("Starting generation...");
    setError(null);
    setLoading(true);
    setGeneratedImages([]);

    try {
      console.log("Fetching /api/generate...");
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompts: promptsToUse,
          referenceImage: null, // Nu mai trimitem imaginea, prompturile sunt deja optimizate
          variantsCount: 1, // Nu mai generăm variante, folosim prompturile editate
        }),
      });

      console.log("Response status:", response.status);
      if (!response.ok) {
        throw new Error("Eroare la generare imagini");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Nu se poate citi response");

      console.log("Starting to read stream...");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("Stream finished");
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              console.log("Received data:", data);
              setGeneratedImages((prev) => {
                // Dacă imaginea nu există, o adăugăm
                const exists = prev.find(img => img.id === data.id);
                if (!exists) {
                  console.log("Adding new image:", data.id);
                  return [...prev, data];
                }
                // Dacă există, o actualizăm
                console.log("Updating existing image:", data.id);
                return prev.map((img) =>
                  img.id === data.id ? { ...img, ...data } : img
                );
              });
            } catch (e) {
              console.error("Eroare parse JSON:", e, "Line:", line);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare necunoscută");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadAll = () => {
    const doneBatch = generatedImages
      .filter((img) => img.status === "done")
      .map((img) => `${img.prompt}\n${img.url}`)
      .join("\n\n");

    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/plain;charset=utf-8," + encodeURIComponent(doneBatch)
    );
    element.setAttribute("download", "images-links.txt");
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
            AI Image Generator
          </h1>
          <p className="text-gray-600">Generează imagini în paralel cu DALL-E 3</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-800">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Control Panel */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white rounded-xl shadow-lg p-6 space-y-4">
              <h2 className="text-lg font-semibold">Imagine de referință</h2>
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:bg-gray-50 transition"
                onClick={() => fileInputRef.current?.click()}
              >
                {referenceImage ? (
                  <div className="flex flex-col items-center gap-2">
                    <Image className="h-8 w-8 text-purple-600" />
                    <p className="text-sm font-medium">{referenceImage.name}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Image className="h-8 w-8 text-gray-400" />
                    <p className="text-sm text-gray-500">Click pentru upload</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleReferenceImageChange}
                className="hidden"
              />
              {referenceImage && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    Câte variante să genereze AI-ul?
                  </label>
                  <select
                    value={variantsCount}
                    onChange={(e) => setVariantsCount(Number(e.target.value))}
                    className="w-full border-2 border-gray-300 rounded-lg p-2 focus:border-purple-500 focus:outline-none"
                  >
                    <option value={2}>2 variante</option>
                    <option value={3}>3 variante</option>
                    <option value={4}>4 variante</option>
                    <option value={5}>5 variante</option>
                    <option value={6}>6 variante</option>
                  </select>
                  <p className="text-xs text-gray-500">
                    AI-ul va genera automat {variantsCount} prompturi diferite bazate pe cererea ta
                  </p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6 space-y-3">
              <h2 className="text-lg font-semibold">Acțiuni</h2>
              {!showPromptPreview ? (
                <button
                  onClick={handleGeneratePrompts}
                  disabled={loading || prompts.filter((p) => p.trim()).length === 0 || !referenceImage}
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-3 rounded-lg font-medium hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Generez prompturi...
                    </>
                  ) : (
                    "Pas 1: Generează prompturi cu AI"
                  )}
                </button>
              ) : (
                <>
                  <button
                    onClick={handleGenerate}
                    disabled={loading || generatedPrompts.length === 0}
                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-3 rounded-lg font-medium hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Generez imagini...
                      </>
                    ) : (
                      "Pas 2: Generează imaginile"
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowPromptPreview(false);
                      setGeneratedPrompts([]);
                    }}
                    className="w-full border-2 border-gray-300 py-2 rounded-lg font-medium hover:bg-gray-50 transition text-sm"
                  >
                    Înapoi la pas 1
                  </button>
                </>
              )}
              {generatedImages.some((img) => img.status === "done") && (
                <button
                  onClick={handleDownloadAll}
                  className="w-full border-2 border-gray-300 py-3 rounded-lg font-medium hover:bg-gray-50 transition flex items-center justify-center gap-2"
                >
                  <Download className="h-5 w-5" />
                  Download linkuri
                </button>
              )}
            </div>
          </div>

          {/* Prompts Panel */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl shadow-lg p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold">
                  Prompturi ({prompts.filter((p) => p.trim()).length})
                </h2>
                <button
                  onClick={handleAddPrompt}
                  className="flex items-center gap-2 px-4 py-2 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  <Plus className="h-4 w-4" />
                  Adaugă
                </button>
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {prompts.map((prompt, idx) => (
                  <div key={idx} className="border rounded-lg p-3 space-y-3">
                    <div className="flex gap-2 items-center">
                      <select
                        value={promptTypes[idx] || 'main'}
                        onChange={(event) => handlePromptTypeChange(idx, event.target.value)}
                        className="w-44 border-2 border-gray-300 rounded-lg p-2 text-sm focus:border-purple-500 focus:outline-none"
                      >
                        {DEFAULT_TEMPLATES.map((template) => (
                          <option key={template.key} value={template.key}>
                            {template.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleRemovePrompt(idx)}
                        className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition"
                        aria-label="Remove prompt"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                    <textarea
                      placeholder={`Prompt ${idx + 1}...`}
                      value={prompt}
                      onChange={(e) => handlePromptChange(idx, e.target.value)}
                      className="w-full resize-none border-2 border-gray-300 rounded-lg p-3 focus:border-purple-500 focus:outline-none"
                      rows={3}
                    />
                    <div className="text-xs text-gray-500">
                      Template default: {DEFAULT_TEMPLATES.find((template) => template.key === (promptTypes[idx] || 'main'))?.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {showPromptPreview ? (
              <div className="bg-white rounded-xl shadow-lg p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-semibold">
                    Prompturi generate de GPT-5.3 ({generatedPrompts.length})
                  </h2>
                  <span className="text-sm text-green-600 font-medium">
                    Alege tipul, apoi editează promptul
                  </span>
                </div>
                <div className="space-y-3 max-h-[32rem] overflow-y-auto">
                  {generatedPrompts.map((prompt, idx) => (
                    <div key={idx} className="border-2 border-green-200 rounded-lg p-3 bg-green-50 space-y-3">
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-green-700">Tip imagine</label>
                        <select
                          value={promptTypes[idx] || 'main'}
                          onChange={(event) => handlePromptTypeChange(idx, event.target.value)}
                          className="w-full border-2 border-green-300 rounded-lg p-2 text-sm bg-white focus:border-green-500 focus:outline-none"
                        >
                          {DEFAULT_TEMPLATES.map((template) => (
                            <option key={template.key} value={template.key}>
                              {template.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-green-700">
                          {DEFAULT_TEMPLATES.find((template) => template.key === (promptTypes[idx] || 'main'))?.label || 'MAIN'}
                        </span>
                        <button
                          className="text-xs text-green-700 hover:underline"
                          onClick={() => {
                            const next = [...generatedPrompts];
                            next[idx] = DEFAULT_TEMPLATES.find((template) => template.key === (promptTypes[idx] || 'main'))?.value || prompt;
                            setGeneratedPrompts(next);
                          }}
                        >
                          Restore default
                        </button>
                      </div>
                      <textarea
                        value={prompt}
                        onChange={(e) => {
                          const next = [...generatedPrompts];
                          next[idx] = e.target.value;
                          setGeneratedPrompts(next);
                        }}
                        className="w-full resize-none border-2 border-green-300 rounded-lg p-3 focus:border-green-500 focus:outline-none bg-white"
                        rows={4}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Generated Images Grid */}
        {generatedImages.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-lg font-semibold mb-4">
              Imagini generate ({generatedImages.filter((img) => img.status === "done").length}/{generatedImages.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {generatedImages.map((img) => (
                <div key={img.id} className="border-2 border-gray-200 rounded-lg overflow-hidden flex flex-col">
                  <div className="aspect-square bg-gray-100 flex items-center justify-center relative">
                    {img.status === "pending" && (
                      <div className="text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-gray-400 mx-auto mb-2" />
                        <p className="text-xs text-gray-500">În așteptare...</p>
                      </div>
                    )}
                    {img.status === "generating" && (
                      <div className="text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-purple-600 mx-auto mb-2" />
                        <p className="text-xs text-gray-600">Generez...</p>
                      </div>
                    )}
                    {img.status === "done" && img.url && (
                      <img
                        src={img.url}
                        alt="Generated"
                        className="w-full h-full object-cover"
                      />
                    )}
                    {img.status === "error" && (
                      <div className="text-center p-4">
                        <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-500" />
                        <p className="text-xs text-red-600">{img.error || "Eroare"}</p>
                      </div>
                    )}
                  </div>
                  <div className="p-3 flex-1 flex flex-col">
                    <p className="text-xs text-gray-600 line-clamp-2 mb-2">
                      {img.prompt}
                    </p>
                    {img.url && (
                      <button
                        onClick={() => window.open(img.url, "_blank")}
                        className="mt-auto bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700 transition text-sm"
                      >
                        Deschide
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
// cache bust Fri Apr 24 20:49:47 UTC 2026
