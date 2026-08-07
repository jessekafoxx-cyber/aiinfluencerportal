import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  OffthreadVideo,
  spring,
  interpolate,
} from "remotion";

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface SubtitledClipProps {
  videoUrl: string;
  words: WordTimestamp[];
  fontSize?: number;
  fontFamily?: string;
  highlightColor?: string;
}

export const SubtitledClipComposition: React.FC<SubtitledClipProps> = ({
  videoUrl,
  words,
  fontSize = 64,
  fontFamily = "Inter, Arial, sans-serif",
  highlightColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const activeWord = words.find(
    (w) => currentTime >= w.start && currentTime < w.end
  );

  const activeIndex = activeWord
    ? words.findIndex((w) => w === activeWord)
    : -1;

  const wordEntryProgress = activeWord
    ? spring({
        frame: frame - Math.round(activeWord.start * fps),
        fps,
        config: { damping: 18, stiffness: 280, mass: 0.4 },
      })
    : 0;

  return (
    <AbsoluteFill>
      {videoUrl && (
        <AbsoluteFill>
          <OffthreadVideo
            src={videoUrl}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </AbsoluteFill>
      )}

      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          paddingBottom: "12%",
        }}
      >
        {activeWord && (
          <div
            style={{
              transform: `scale(${interpolate(wordEntryProgress, [0, 1], [0.7, 1])}) translateY(${interpolate(wordEntryProgress, [0, 1], [10, 0])}px)`,
              opacity: wordEntryProgress,
            }}
          >
            <span
              style={{
                fontFamily,
                fontSize,
                fontWeight: 900,
                color: highlightColor || "#FFFFFF",
                textTransform: "uppercase",
                letterSpacing: 2,
                WebkitTextStroke: `${Math.max(2, fontSize / 20)}px #000000`,
                paintOrder: "stroke fill",
                textShadow:
                  "0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)",
                lineHeight: 1.1,
                textAlign: "center",
                display: "block",
                maxWidth: "80%",
                wordBreak: "break-word",
              }}
            >
              {activeWord.word}
            </span>
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
