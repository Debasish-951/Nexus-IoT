import type { ReactNode } from "react";
import { useT } from "@/i18n";
import { useCurrentUser } from "@/contexts/UserContext";

function timeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The greeting at the top of both Home views. Each word jumps in, one after another,
 * when the view opens (styles/greeting.css).
 */
export function Greeting({ subtitle }: { subtitle: ReactNode }) {
  const { currentUser } = useCurrentUser();
  const t = useT();
  const firstName = currentUser?.fullName?.split(" ")[0];
  // The user's name is data and stays as stored; only the greeting is translated.
  const text = firstName ? t("{greeting}, {name}", { greeting: t(timeOfDay()), name: firstName }) : t(timeOfDay());

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight text-primary">
        {text.split(" ").map((word, i) => (
          <span key={i}>
            {i > 0 && " "}
            <span className="greeting-word" style={{ animationDelay: `${i * 200}ms` }}>{word}</span>
          </span>
        ))}
      </h1>
      <p className="text-[15px] text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}
