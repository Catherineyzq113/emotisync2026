"use client";

import { VoiceProvider } from "@humeai/voice-react";
import { useRef, useState } from "react";
import Messages from "./Messages";
import Controls from "./Controls";
import StartCall from "./StartCall";
import { expressionColors } from "@/utils/expressionColors";

const fallbackColor = "#fde68a";

type Task = {
  task: string;
  duration: number;
  beforeColor: string;
  afterColor: string;
  before: string | null;
  after: string | null;
};

export default function ClientComponent({ accessToken }: { accessToken: string }) {
  const timeout = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const lastTopEmotionRef = useRef<string | null>(null);
  const recentMessagesRef = useRef<string[]>([]);

  const [emotionScores, setEmotionScores] = useState<Record<string, number> | undefined>(undefined);
  const [suggestedTasks, setSuggestedTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [chainedTasks, setChainedTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  type StressCategory =
    | "Low-Stress or Relaxing Emotions"
    | "Moderate-Stress Emotions"
    | "High-Stress Emotions";

  const getStressCategory = (emotion: string): StressCategory => {
    const e = emotion.toLowerCase();

    // Sourced from emotionTaskMapping.json "Stress Category" field
    const low = [
      "calmness", "joy", "aestheticappreciation", "tiredness", "amusement",
      "sympathy", "satisfaction", "nostalgia", "gratitude", "pride",
      "entrancement", "admiration", "relief", "adoration", "love",
      "contemplation", "excitement", "interest", "awe", "triumph",
    ];
    const moderate = [
      "concentration", "romance", "sexualdesire", "annoyance", "embarrassment",
      "realization", "boredom", "determination", "clarity", "contentment",
      "surprise", "awkwardness", "confusion", "ecstasy", "enthusiasm",
      "sadness", "sarcasm", "surprisenegative", "surprisepositive",
    ];
    const high = [
      "shame", "empathicpain", "pain", "anxiety", "distress", "guilt",
      "disappointment", "contempt", "fear", "disgust", "envy", "craving",
      "anger", "disapproval", "doubt", "horror",
    ];

    if (low.includes(e)) return "Low-Stress or Relaxing Emotions";
    if (high.includes(e)) return "High-Stress Emotions";
    if (moderate.includes(e)) return "Moderate-Stress Emotions";
    return "Moderate-Stress Emotions"; // fallback
  };

  const mapApiTasks = (items: any[]): Task[] =>
    items.map((item) => ({
      task: item["Subject"],
      duration: item["Duration"] || 1,
      beforeColor: expressionColors[item["Before Task Emotion"] as keyof typeof expressionColors] || fallbackColor,
      afterColor: expressionColors[item["After Task Emotion"] as keyof typeof expressionColors] || fallbackColor,
      before: item["Before Task Emotion"],
      after: item["After Task Emotion"],
    }));

  const fetchTasksForEmotion = async (emotion: string): Promise<Task[]> => {
    const stressCategory = getStressCategory(emotion);
    const taskCount = stressCategory === "High-Stress Emotions" ? 2 : stressCategory === "Low-Stress or Relaxing Emotions" ? 3 : 1;
    const res = await fetch("/api/suggest-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topEmotion: emotion, stressCategory, taskCount, recentMessages: recentMessagesRef.current }),
    });
    const data = await res.json();
    return mapApiTasks(Array.isArray(data) ? data : []);
  };

  return (
    <div className="relative flex flex-col justify-between items-center w-screen h-screen overflow-hidden">
      <VoiceProvider auth={{ type: "accessToken", value: accessToken }}
        onMessage={(message: any) => {
          try {
            if (message?.message?.role !== "user") return;

            // Accumulate spoken text — keep last 8 messages for context
            const text = message?.message?.content;
            if (text) {
              recentMessagesRef.current = [...recentMessagesRef.current, text].slice(-8);
            }

            const scores = message?.models?.prosody?.scores;
            if (scores && typeof scores === "object") {
              setEmotionScores(scores);
              const sortedEmotions = Object.entries(scores).sort((a, b) => (b[1] as number) - (a[1] as number));
              const topEmotion = sortedEmotions[0]?.[0];

              if (topEmotion && topEmotion !== lastTopEmotionRef.current) {
                lastTopEmotionRef.current = topEmotion;
                setLoadingTasks(true);
                fetchTasksForEmotion(topEmotion)
                  .then((tasks) => setSuggestedTasks(tasks))
                  .catch((err) => console.error("❌ Error fetching tasks:", err))
                  .finally(() => setLoadingTasks(false));
              }
            }
          } catch (error) {
            console.error("❌ Error parsing emotion scores:", error);
          }

          if (timeout.current) clearTimeout(timeout.current);
          timeout.current = window.setTimeout(() => {
            if (ref.current) {
              ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
            }
          }, 200);
        }}
      >
        <div ref={ref} className="flex flex-col items-center justify-center h-screen w-[900px]">

          <Messages values={emotionScores} />

          {/* Background video — disabled
          {selectedTask && (() => {
            const stressCategory = selectedTask.before ? getStressCategory(selectedTask.before) : null;
            let videoSrc = "/uplifting.mp4";
            if (stressCategory === "Low-Stress or Relaxing Emotions") videoSrc = "/linspiring.mp4";
            else if (stressCategory === "High-Stress Emotions") videoSrc = "/reflective2.mp4";
            else if (stressCategory === "Moderate-Stress Emotions") videoSrc = "/playful.mp4";
            return (
              <video
                key={selectedTask.task}
                autoPlay
                loop
                className="fixed top-0 left-0 w-full h-full object-cover opacity-100 z-0 pointer-events-none"
              >
                <source src={videoSrc} type="video/mp4" />
              </video>
            );
          })()}
          */}

          <div className="flex flex-col items-center justify-center space-y-6 mt-6">
            {selectedTask === null ? (
              <div className="flex flex-col items-center space-y-8">
                {loadingTasks && (
                  <div className="text-white text-lg opacity-70 animate-pulse">Finding tasks for you…</div>
                )}
                {!loadingTasks && suggestedTasks.map((task, idx) => (
                  <div
                    key={idx}
                    onClick={async () => {
                      setSelectedTask(task);
                      setChainedTasks([]);
                      if (!task.after) return;
                      const [chained] = await Promise.all([
                        fetchTasksForEmotion(task.after),
                        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
                      ]);
                      setChainedTasks(chained);
                    }}
                    className="relative cursor-pointer p-4 rounded-2xl text-white shadow-md flex flex-col items-center justify-center overflow-hidden break-words transition-all duration-500 z-10"
                    style={{
                      width: 300 + (task.duration || 1) * 300,
                      background: `linear-gradient(135deg, ${task.beforeColor}, ${task.afterColor})`,
                    }}
                  >
                    <svg viewBox="0 0 100 100" preserveAspectRatio="xMinYMid meet" className="absolute" style={{ width: "100%", height: "100%", top: 0, left: 0, color: "rgba(255, 255, 255, 0.75)", fontFamily: "'Playfair Display', serif", fontWeight: 400, textAlign: "center", zIndex: 2, pointerEvents: "none" }}>
                      <text x="150" y="50" textAnchor="middle" dominantBaseline="central" fontSize="80" fill="rgba(255, 255, 255, 0.75)">{task.duration} hr</text>
                    </svg>
                    <div className="text-center px-4 leading-snug break-words z-30" style={{ color: "black", fontSize: "24px", fontWeight: 600, lineHeight: "1" }}>{task.task}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-row items-start justify-center gap-16">
                {/* Selected Task */}
                <div className="flex flex-col items-center">
                  <div
                    key={selectedTask.task}
                    className="relative cursor-pointer p-6 rounded-2xl text-white shadow-lg flex flex-col items-center justify-center overflow-hidden break-words transition-all duration-500 z-10"
                    style={{ minWidth: "300px", background: `linear-gradient(135deg, ${selectedTask.beforeColor}, ${selectedTask.afterColor})` }}
                  >
                    <div className="absolute inset-0 rounded-2xl pointer-events-none z-20">
                      <div className="absolute top-0 left-0 h-1 bg-white rounded-t-2xl origin-left animate-grow-width" />
                      <div className="absolute top-0 right-0 w-1 bg-white rounded-tr-2xl origin-top animate-grow-height" style={{ animationDelay: "12.5s" }} />
                      <div className="absolute bottom-0 right-0 h-1 bg-white rounded-b-2xl origin-right animate-grow-width" style={{ animationDelay: "25s" }} />
                      <div className="absolute bottom-0 left-0 w-1 bg-white rounded-bl-2xl origin-bottom animate-grow-height" style={{ animationDelay: "37.5s" }} />
                    </div>
                    <svg viewBox="0 0 100 100" preserveAspectRatio="xMinYMid meet" className="absolute" style={{ width: "100%", height: "100%", top: 0, left: 0, color: "rgba(255, 255, 255, 0.75)", fontFamily: "'Playfair Display', serif", fontWeight: 400, textAlign: "center", zIndex: 2, pointerEvents: "none" }}>
                      <text x="150" y="50" textAnchor="middle" dominantBaseline="central" fontSize="80" fill="rgba(255, 255, 255, 0.75)">{selectedTask.duration} hr</text>
                    </svg>
                    <div className="text-center px-4 leading-snug break-words z-30" style={{ color: "black", fontSize: "26px", fontWeight: 700, lineHeight: "1" }}>{selectedTask.task}</div>
                  </div>
                </div>

                {/* Chained Tasks */}
                <div className="flex flex-col items-start gap-6">
                  {chainedTasks.map((task, idx) => (
                    <div
                      key={"chained-" + idx}
                      onClick={async () => {
                        setSelectedTask(task);
                        setChainedTasks([]);
                        if (!task.after) return;
                        const newChained = await fetchTasksForEmotion(task.after);
                        setChainedTasks(newChained);
                      }}
                      className="relative cursor-pointer p-4 rounded-2xl text-white shadow-md flex flex-col items-center justify-center overflow-hidden break-words transition-all duration-500 z-10"
                      style={{
                        opacity: 0.5,
                        minWidth: "280px",
                        maxWidth: "90%",
                        background: `linear-gradient(135deg, ${task.beforeColor}, ${task.afterColor})`,
                      }}
                    >
                      <svg viewBox="0 0 100 100" preserveAspectRatio="xMinYMid meet" className="absolute" style={{ width: "100%", height: "100%", top: 0, left: 0, color: "rgba(255, 255, 255, 0.75)", fontFamily: "'Playfair Display', serif", fontWeight: 400, textAlign: "center", zIndex: 2, pointerEvents: "none" }}>
                        <text x="150" y="50" textAnchor="middle" dominantBaseline="central" fontSize="80" fill="rgba(255, 255, 255, 0.75)">{task.duration} hr</text>
                      </svg>
                      <div className="text-center px-4 leading-snug break-words z-30" style={{ color: "black", fontSize: "24px", fontWeight: 600, lineHeight: "1" }}>{task.task}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <Controls />
        <StartCall />
      </VoiceProvider>
    </div>
  );
}
