"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DELETE_ERROR_MESSAGE, conversationApiUrl } from "@/lib/amber-chat-client";

// Lekcja 5, Warsztat 2 (Dla szybkich): „Usuń” przy rozmowie na /history.
// Najpierw pytanie o potwierdzenie; potem DELETE /api/conversations/[id] (serwer sprawdza sesję)
// i odświeżenie listy. Wiadomości rozmowy usuwa baza (ON DELETE CASCADE).
export default function DeleteConversationButton({ id, title, confirmMessage }: { id: number; title: string; confirmMessage: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (busy || !window.confirm(confirmMessage)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(conversationApiUrl(id), { method: "DELETE" });
      // 404 = rozmowy już nie ma (np. usunięta w innej karcie) – lista i tak się odświeży.
      if (!response.ok && response.status !== 404) {
        setError(DELETE_ERROR_MESSAGE);
        return;
      }
      router.refresh();
    } catch {
      setError(DELETE_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="history-actions">
      <button type="button" className="history-delete" disabled={busy} onClick={handleDelete} aria-label={`Usuń rozmowę: ${title}`}>
        {busy ? "Usuwam…" : "Usuń"}
      </button>
      {error && (
        <small className="image-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
