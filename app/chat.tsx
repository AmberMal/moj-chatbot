"use client";

import { useChat } from "@ai-sdk/react";
import Link from "next/link";
import { DefaultChatTransport, type UIMessage } from "ai";
import { createSupabaseBrowserClient } from "../lib/supabase-auth/client";
import { Fragment, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AGENT_API,
  HISTORY_LOAD_ERROR,
  HISTORY_LOADING_MESSAGE,
  HISTORY_NOT_FOUND,
  HISTORY_PAGE,
  LATEST_CONVERSATION_API,
  NEW_CONVERSATION_URL,
  PROFILE_API,
  PROFILE_PAGE,
  conversationApiUrl,
  conversationFromSearch,
  conversationPageUrl,
  MAX_IMAGE_DESCRIPTION_CHARS,
  NO_IMAGE_MESSAGE,
  STEP_LIMIT_MESSAGE,
  STOPPED_MESSAGE,
  buildStepList,
  canStop,
  formatAgentStats,
  formatStepList,
  buildImageRequest,
  hasImageToolPart,
  hasVisibleContent,
  markStoppedQuestion,
  stopNoteTarget,
  stoppedQuestionId,
  imageDownloadName,
  isStepLimit,
  prepareAgentMessages,
  readAnalysisResponse,
  readGeneratedImagePart,
  readKnowledgeSources,
  readConversationId,
  readLatestConversation,
  readProfileResponse,
  type AnalysisResult,
} from "@/lib/amber-chat-client";

// Limit długości wiadomości klienta – taki sam jak na serwerze (lib/amber-history.ts).
const MAX_MESSAGE_CHARS = 4000;
// Informacja o limicie pokazuje się dopiero przy długiej wiadomości.
const SHOW_LIMIT_FROM = 3500;

// Lekcja 3: etykiety użytych narzędzi (nad odpowiedzią Amber).
const TOOL_LABELS: Record<string, string> = {
  wyszukiwanie: "🔎 wyszukiwanie",
  aktualnyCzas: "🕒 aktualnyCzas",
  sprawdzObszar: "📍 sprawdzObszar",
  informacjeOUrzadzeniu: "🔧 informacjeOUrzadzeniu",
  generujObraz: "🎨 generujObraz",
  // Lekcja 4 (aktualnyCzas zostaje dla starszych rozmów).
  czas: "🕒 czas",
  pogoda: "🌤 pogoda",
  waluty: "💱 waluty",
  swieta: "📅 swieta",
  wikipedia: "📖 wikipedia",
  kalkulator: "🧮 kalkulator",
  notatki: "📝 notatki",
  diagnostyka: "🩺 diagnostyka",
  przestepczosc: "📊 przestepczosc",
  // Lekcja 5, Warsztat 3: zapis w profilu klienta.
  zapiszProfil: "👤 zapiszProfil",
  // Lekcja 6, Warsztat 3 (Standard): wyszukiwanie w bazie wiedzy.
  searchKnowledge: "📚 baza wiedzy",
};

// Lekcja 3 (Vision): zdjęcia jpg/png/webp do 4 MB. Przed wysłaniem przeglądarka
// zmniejsza zdjęcie (maks. 1600 px, JPEG), żeby zmieściło się w limitach serwera.
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;
const MAX_IMAGE_DATA_URL_CHARS = 3_000_000; // taki sam limit jak na serwerze (lib/amber-history.ts)

type PendingImage = { url: string; name: string };

// Etap 4: „Wygeneruj obraz” wysyła prośbę do /api/agent (mode=chat) – obraz generuje narzędzie wybrane przez model.
const MAX_IMAGE_PROMPT_CHARS = MAX_IMAGE_DESCRIPTION_CHARS; // 500, tak samo jak w narzędziu generujObraz
// Klikalne podpowiedzi opisów obrazu (wpisują tekst do pola – nie wysyłają, bo generowanie jest płatne).
const IMAGE_PROMPT_SUGGESTIONS = [
  "Plakat: dom chroniony systemem alarmowym, nowoczesny styl, kolory bursztynowy i grafitowy",
  "Zdjęcie produktowe: nowoczesna klawiatura alarmu na białej ścianie w jasnym korytarzu",
  "Grafika do social media: kamera CCTV na elewacji londyńskiej kamienicy o zmierzchu",
];

// Warsztat 3: „Analiza JSON” (mode=analyze) – wynik widoczny tylko w tym oknie, nie trafia do historii rozmowy.
type JsonAnalysis = {
  id: string;
  afterCount: number;
  text: string;
  status: "loading" | "done" | "error";
  createdAt: Date;
  result?: AnalysisResult;
  model?: string;
  error?: string;
};

async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.fillStyle = "#ffffff"; // tło dla przezroczystych PNG
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Warsztat 3: czat korzysta z /api/agent (mode=chat).
// Przed wysłaniem historii (lib/amber-chat-client.ts): bez niepodpisanych odpowiedzi Amber,
// pełne zdjęcie tylko w najnowszych wiadomościach, bez plików wygenerowanych obrazów.
const transport = new DefaultChatTransport<UIMessage>({
  api: AGENT_API,
  prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => ({
    body: { ...body, mode: "chat", id, messages: prepareAgentMessages(messages), trigger, messageId },
  }),
});

export default function Chat({
  email,
  name = null,
  avatarUrl = null,
}: {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}) {
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Etap 4: trwa prośba o obraz wysłana przyciskiem „Wygeneruj obraz”.
  const [imageRequestPending, setImageRequestPending] = useState(false);
  const imageRequestRef = useRef(false);
  // Odpowiedzi na prośbę o obraz, w których model nie wywołał narzędzia generujObraz.
  const [noImageIds, setNoImageIds] = useState<string[]>([]);
  const [analyses, setAnalyses] = useState<JsonAnalysis[]>([]);
  const isAnalyzing = analyses.some((item) => item.status === "loading");
  // Odpowiedzi zatrzymane limitem 5 kroków (komunikat pod odpowiedzią).
  const [stepLimitIds, setStepLimitIds] = useState<string[]>([]);
  // Lekcja 4, Warsztat 2 (Fast): odpowiedzi przerwane przyciskiem „Stop” (komunikat pod częściowym wynikiem)
  // i pytania, po których Stop kliknięto, zanim pojawiła się odpowiedź.
  const [stoppedIds, setStoppedIds] = useState<string[]>([]);
  const [stoppedAfterIds, setStoppedAfterIds] = useState<string[]>([]);
  // Oznaczenie przerwanego pytania w stanie czatu (setMessages z useChat – dostępne dopiero po wywołaniu hooka).
  const setMessagesRef = useRef<((update: (messages: UIMessage[]) => UIMessage[]) => void) | null>(null);
  // Lekcja 5, Warsztat 2: numer bieżącej rozmowy w bazie (null = nowa rozmowa) i wczytywanie ostatniej rozmowy po F5.
  const conversationIdRef = useRef<number | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"loading" | "ready" | "error" | "not-found">("loading");
  // Lekcja 5, Warsztat 3 (Standard): powitanie w pustej rozmowie (z imieniem z profilu). Tylko na ekranie – nie trafia do historii.
  const [greeting, setGreeting] = useState<string | null>(null);
  // useChat wysyła historię rozmowy do /api/agent (mode=chat) i odbiera odpowiedź strumieniowo.
  const { messages, sendMessage, status, error, clearError, stop, setMessages } = useChat({
    transport,
    onFinish: ({ message, messages: all, finishReason, isError, isAbort }) => {
      // Lekcja 5: serwer zapisał wiadomości w bazie – kolejne trafią do tej samej rozmowy.
      const savedId = readConversationId(message.metadata);
      if (savedId !== null && savedId !== conversationIdRef.current) {
        conversationIdRef.current = savedId;
        // Standard: adres pokazuje bieżącą rozmowę (F5 zostaje w tej rozmowie).
        window.history.replaceState(null, "", conversationPageUrl(savedId));
      }
      if (isAbort) {
        const target = stopNoteTarget(message, all);
        if (target?.kind === "assistant") setStoppedIds((ids) => [...ids, target.id]);
        if (target?.kind === "user") setStoppedAfterIds((ids) => [...ids, target.id]);
        // Pytanie przerwanego zadania dostaje znacznik → w historii notatka STOPPED_TASK_NOTE (lib/amber-chat-client.ts).
        const questionId = stoppedQuestionId(all);
        if (questionId) setMessagesRef.current?.((current) => markStoppedQuestion(current, questionId));
      }
      if (isStepLimit(finishReason)) setStepLimitIds((ids) => [...ids, message.id]);
      if (imageRequestRef.current && !isError && !isAbort && !hasImageToolPart(message)) {
        setNoImageIds((ids) => [...ids, message.id]);
      }
      imageRequestRef.current = false;
      setImageRequestPending(false);
    },
    onError: () => {
      imageRequestRef.current = false;
      setImageRequestPending(false);
    },
  });

  setMessagesRef.current = setMessages;

  // Lekcja 5, Warsztat 2: po otwarciu strony wczytujemy rozmowę z bazy (serwer najpierw sprawdza sesję):
  // /?c=12 – wybraną (Standard, /history), /?new=1 – żadnej (nowa rozmowa), / – ostatnią.
  useEffect(() => {
    let cancelled = false;
    const target = conversationFromSearch(window.location.search);
    if (target.kind === "new") {
      setHistoryStatus("ready");
      return;
    }
    (async () => {
      try {
        const url = target.kind === "id" ? conversationApiUrl(target.id) : LATEST_CONVERSATION_API;
        const response = await fetch(url, { cache: "no-store" });
        if (cancelled) return;
        if (!response.ok) {
          // Nie ma takiej rozmowy / błąd: zaczynamy nową, adres nie wskazuje już starej rozmowy.
          if (target.kind === "id") window.history.replaceState(null, "", NEW_CONVERSATION_URL);
          // Lekcja 7: cudza albo nieistniejąca rozmowa → „Nie znaleziono”, bez żadnych danych.
          setHistoryStatus(response.status === 401 ? "ready" : response.status === 404 ? "not-found" : "error");
          return;
        }
        const data = readLatestConversation(await response.json().catch(() => null));
        if (cancelled) return;
        if (!data) {
          setHistoryStatus("error");
          return;
        }
        conversationIdRef.current = data.conversationId;
        if (data.messages.length > 0) setMessages(data.messages);
        if (data.conversationId !== null) window.history.replaceState(null, "", conversationPageUrl(data.conversationId));
        setHistoryStatus("ready");
      } catch {
        if (!cancelled) setHistoryStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Tylko raz, po otwarciu strony.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warsztat 3 (Standard): powitanie z profilu – po otwarciu strony i po „Nowa rozmowa” (imię mogło się zmienić).
  async function loadGreeting() {
    try {
      const response = await fetch(PROFILE_API, { cache: "no-store" });
      if (!response.ok) return;
      const data = readProfileResponse(await response.json().catch(() => null));
      if (data) setGreeting(data.greeting);
    } catch {
      // bez powitania – zostaje zwykła podpowiedź
    }
  }
  useEffect(() => {
    void loadGreeting();
  }, []);

  // Każda wiadomość do /api/agent niesie numer rozmowy (null = serwer założy nową rozmowę).
  const sendChat = (message: Parameters<typeof sendMessage>[0]) =>
    sendMessage(message, { body: { conversationId: conversationIdRef.current } });
  const isBusy = status === "submitted" || status === "streaming";
  const isGenerating = imageRequestPending && isBusy;
  // „Model pisze…” – od wysłania aż do pojawienia się pierwszej treści odpowiedzi (bez pustego dymka).
  const lastMessage = messages[messages.length - 1];
  const waitingForContent =
    status === "submitted" ||
    (status === "streaming" && lastMessage?.role === "assistant" && !hasVisibleContent(lastMessage));
  // Gdy Amber pisze, trwa generowanie obrazu albo analiza – wszystkie przyciski są zablokowane.
  const isLocked = isBusy || isGenerating || isAnalyzing || historyStatus === "loading";
  const canSend = (input.trim().length > 0 || pendingImage !== null) && !isLocked;
  const canGenerate = input.trim().length > 0 && input.trim().length <= MAX_IMAGE_PROMPT_CHARS && !isLocked;
  const canAnalyze = input.trim().length > 0 && input.trim().length <= MAX_MESSAGE_CHARS && !isLocked;

  // Warsztat 3: „Analiza JSON” – wysyła wyłącznie wpisany tekst do /api/agent (mode=analyze), bez historii.
  async function handleAnalyze() {
    const text = input.trim();
    if (!canAnalyze) return;
    const id = `analysis-${Date.now()}`;
    const update = (patch: Partial<JsonAnalysis>) =>
      setAnalyses((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setAnalyses((items) => [...items, { id, afterCount: messages.length, text, status: "loading", createdAt: new Date() }]);
    setInput("");
    try {
      const response = await fetch(AGENT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "analyze", text }),
      });
      if (response.status === 401) {
        update({ status: "error", error: "Sesja wygasła. Zaloguj się ponownie." });
        return;
      }
      if (!response.ok) {
        const message = (await response.text().catch(() => "")).slice(0, 300);
        update({ status: "error", error: message || "Analiza nie powiodła się. Spróbuj ponownie." });
        return;
      }
      const data = readAnalysisResponse(await response.json().catch(() => null));
      if (!data) {
        update({ status: "error", error: "Serwer zwrócił nieprawidłowy wynik analizy. Spróbuj ponownie." });
        return;
      }
      update({ status: "done", result: data.analysis, model: data.model });
    } catch {
      update({ status: "error", error: "Brak połączenia z serwerem. Spróbuj ponownie." });
    }
  }

  // Wyniki „Analiza JSON” w miejscu rozmowy, w którym o nie poproszono.
  function analysesAfter(count: number) {
    return analyses
      .filter((item) => item.afterCount === count)
      .map((item) => (
        <Fragment key={item.id}>
          <div className="message user">
            <span className="image-request">🧾 Analiza JSON: </span>
            <span>{item.text}</span>
          </div>
          <div className={`message assistant${item.status === "loading" ? " pending" : ""}`}>
            {item.status === "loading" && "Analizuję…"}
            {item.status === "error" && <span className="image-error">{item.error}</span>}
            {item.status === "done" && item.result && (
              <>
                <pre className="analysis-json">{JSON.stringify(item.result, null, 2)}</pre>
                {item.model && <small className="model-id">model: {item.model}</small>}
              </>
            )}
          </div>
        </Fragment>
      ));
  }

  // Etap 4: „Wygeneruj obraz” = wiadomość z wyraźną prośbą do /api/agent (mode=chat).
  // Model wybiera narzędzie generujObraz; obraz, model i „Pobierz” pokazuje odpowiedź Amber.
  function handleGenerateImage() {
    const request = buildImageRequest(input);
    if (!request || !canGenerate) return; // opis 1–500 znaków – inaczej nic nie jest wysyłane
    if (error) clearError();
    imageRequestRef.current = true;
    setImageRequestPending(true);
    sendChat({ text: request });
    setInput("");
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // pozwala wybrać ten sam plik ponownie
    setImageError(null);
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError("Można dodać tylko zdjęcie JPG, PNG lub WEBP.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Zdjęcie jest za duże (maksymalnie 4 MB).");
      return;
    }
    try {
      const url = await compressImage(file);
      if (url.length > MAX_IMAGE_DATA_URL_CHARS) {
        setImageError("Nie udało się wystarczająco zmniejszyć zdjęcia. Spróbuj innego pliku.");
        return;
      }
      setPendingImage({ url, name: file.name });
    } catch {
      setImageError("Nie udało się odczytać zdjęcia. Spróbuj innego pliku.");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if ((!text && !pendingImage) || isLocked) return; // blokada pustych wiadomości
    if (error) clearError();
    if (pendingImage) {
      sendChat({
        text,
        files: [{ type: "file", mediaType: "image/jpeg", url: pendingImage.url, filename: pendingImage.name }],
      });
      setPendingImage(null);
    } else {
      sendChat({ text });
    }
    setInput("");
  }

  // Lekcja 5, Warsztat 2: „Nowa rozmowa” – pusty czat; poprzednia rozmowa zostaje w bazie.
  function handleNewConversation() {
    if (isLocked) return;
    conversationIdRef.current = null;
    setMessages([]);
    setAnalyses([]);
    setStoppedIds([]);
    setStoppedAfterIds([]);
    setStepLimitIds([]);
    setNoImageIds([]);
    setPendingImage(null);
    setImageError(null);
    setInput("");
    if (error) clearError();
    setHistoryStatus("ready");
    // Standard: F5 po „Nowa rozmowa” nie przywraca poprzedniej rozmowy.
    window.history.replaceState(null, "", NEW_CONVERSATION_URL);
    void loadGreeting();
  }

  // Lekcja 7: wylogowanie z Supabase (usuwa ciasteczka sesji), potem strona logowania.
  // Standard: najpierw czyścimy ekran (rozmowa, analizy, powitanie z profilu), potem pełne przejście na /login –
  // pamięć strony i podręczna pamięć routera znikają, a „Wstecz” nie wraca do czatu (location.replace).
  async function handleLogout() {
    stop();
    setMessages([]);
    setAnalyses([]);
    setGreeting(null);
    setInput("");
    try {
      await createSupabaseBrowserClient()?.auth.signOut();
    } finally {
      window.location.replace("/login");
    }
  }

  return (
    <>
      <div className="toolbar">
        {/* Lekcja 7: zalogowana osoba – Warsztat 3: imię i avatar z konta Google (konto e-mail: sam adres) */}
        <span className="user-info">
          {avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="user-avatar" src={avatarUrl} alt="" width={32} height={32} referrerPolicy="no-referrer" />
          )}
          <span className="user-text">
            {name && <span className="user-name">{name}</span>}
            {email && <span className="user-email">{email}</span>}
          </span>
        </span>
        {/* Lekcja 5, Warsztat 2: nowa rozmowa (stara zostaje w bazie) */}
        <button type="button" className="logout" disabled={isLocked} onClick={handleNewConversation}>
          Nowa rozmowa
        </button>
        {/* Lekcja 5, Warsztat 2 (Standard): lista zapisanych rozmów */}
        <Link href={HISTORY_PAGE} className="logout">
          Historia
        </Link>
        {/* Lekcja 5, Warsztat 3 (Standard): profil klienta */}
        <Link href={PROFILE_PAGE} className="logout">
          Profil
        </Link>
        {/* Lekcja 6, Warsztat 2: baza wiedzy (wklejanie dokumentów) */}
        <Link href="/upload" className="logout">
          Baza wiedzy
        </Link>
        {/* Lekcja 4, Warsztat 3: link do Dashboardu podróży */}
        <Link href="/dashboard" className="logout">
          Dashboard podróży
        </Link>
        <button type="button" className="logout" onClick={handleLogout}>
          Wyloguj
        </button>
      </div>

      <div className="messages" aria-label="Rozmowa" aria-live="polite">
        {messages.length === 0 && analyses.length === 0 && historyStatus === "loading" && (
          <p className="hint">{HISTORY_LOADING_MESSAGE}</p>
        )}
        {/* Warsztat 3 (Standard): powitanie Amber w nowej rozmowie (bez profilu – zwykła podpowiedź) */}
        {messages.length === 0 && analyses.length === 0 && historyStatus !== "loading" &&
          (greeting ? (
            <div className="message assistant greeting">{greeting}</div>
          ) : (
            <p className="hint">Napisz pierwszą wiadomość, aby zacząć rozmowę.</p>
          ))}

        {analysesAfter(0)}

        {messages.map((message, index) => {
          // Lekcja 3: źródła z wyszukiwania (tylko adresy http/https).
          const sources = message.parts.filter(
            (part) => part.type === "source-url" && /^https?:\/\//i.test(part.url),
          );
          const meta = message.metadata as
            | { fetchedAt?: string; tools?: string[]; model?: string }
            | undefined;
          const fetchedAt = meta?.fetchedAt;
          const toolLabels = Array.isArray(meta?.tools)
            ? meta.tools.filter((name) => name in TOOL_LABELS).map((name) => TOOL_LABELS[name])
            : [];
          // Odpowiedź Amber bez treści (model dopiero zaczyna albo używa narzędzia) – bez pustego dymka.
          if (message.role === "assistant" && !hasVisibleContent(message) && !stoppedIds.includes(message.id)) {
            return <Fragment key={message.id}>{analysesAfter(index + 1)}</Fragment>;
          }
          return (
            <Fragment key={message.id}>
            <div className={`message ${message.role}`}>
              {message.role === "assistant" && buildStepList(message).length > 0 && (
                <div className="agent-steps">Kroki: {formatStepList(buildStepList(message))}</div>
              )}
              {message.role === "assistant" && toolLabels.length > 0 && (
                <div className="tool-labels">
                  {toolLabels.map((label) => (
                    <span key={label} className="tool-label">
                      {label}
                    </span>
                  ))}
                </div>
              )}
              {message.parts.map((part, i) => {
                if (part.type === "text") return <span key={i}>{part.text}</span>;
                // Lekcja 3 (Vision): miniatura wysłanego zdjęcia.
                if (
                  part.type === "file" &&
                  message.role === "user" &&
                  /^data:image\/(jpeg|png|webp);base64,/.test(part.url)
                ) {
                  // eslint-disable-next-line @next/next/no-img-element
                  return <img key={i} className="thumb" src={part.url} alt={part.filename || "Wysłane zdjęcie"} />;
                }
                // Warsztat 3: obraz wygenerowany przez narzędzie modelu (generujObraz).
                const image = message.role === "assistant" ? readGeneratedImagePart(part) : null;
                if (image?.status === "loading") {
                  return <span key={i} className="generating">Generuję obraz…</span>;
                }
                if (image?.status === "error") {
                  return <span key={i} className="image-error">{image.error}</span>;
                }
                if (image?.status === "done") {
                  return (
                    <span key={i} className="generated-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="generated" src={image.url} alt="Wygenerowany obraz" />
                      <span className="image-footer">
                        {image.model && <small className="model-id">model: {image.model}</small>}
                        <a className="download" href={image.url} download={imageDownloadName(image.url, new Date())}>
                          Pobierz
                        </a>
                      </span>
                    </span>
                  );
                }
                return null;
              })}
              {/* Lekcja 6, Warsztat 3 (Standard): źródła z bazy wiedzy – tytuł, podobieństwo i dokładny fragment */}
              {message.role === "assistant" && readKnowledgeSources(message.metadata).length > 0 && (
                <div className="sources knowledge-sources">
                  <strong>Źródła z bazy wiedzy</strong>
                  <ul>
                    {readKnowledgeSources(message.metadata).map((k, i) => (
                      <li key={i}>
                        <details>
                          <summary>
                            {k.tytul} · podobieństwo {k.procent}% <span className="show-fragment">Pokaż fragment</span>
                          </summary>
                          <blockquote>{k.tresc}</blockquote>
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {message.role === "assistant" && sources.length > 0 && (
                <div className="sources">
                  <strong>Źródła</strong>
                  <ul>
                    {sources.map((part, i) =>
                      part.type === "source-url" ? (
                        <li key={i}>
                          <a href={part.url} target="_blank" rel="noopener noreferrer">
                            {part.title || part.url}
                          </a>
                        </li>
                      ) : null,
                    )}
                  </ul>
                  {fetchedAt && <small>pobrano: {fetchedAt}</small>}
                </div>
              )}
              {message.role === "assistant" && meta?.model && (
                <small className="model-id">model: {meta.model}</small>
              )}
              {message.role === "assistant" && formatAgentStats(message.metadata) && (
                <small className="agent-stats">{formatAgentStats(message.metadata)}</small>
              )}
              {message.role === "assistant" && stoppedIds.includes(message.id) && (
                <small className="stopped-note">⏹ {STOPPED_MESSAGE}</small>
              )}
              {message.role === "assistant" && noImageIds.includes(message.id) && (
                <small className="image-error step-limit">{NO_IMAGE_MESSAGE}</small>
              )}
              {message.role === "assistant" &&
                stepLimitIds.includes(message.id) &&
                !message.parts.some((part) => part.type === "text" && part.text.trim().length > 0) && (
                <small className="step-limit">⚠️ {STEP_LIMIT_MESSAGE}</small>
              )}
            </div>
            {message.role === "user" && stoppedAfterIds.includes(message.id) && (
              <div className="message assistant">
                <small className="stopped-note">⏹ {STOPPED_MESSAGE}</small>
              </div>
            )}
            {analysesAfter(index + 1)}
            </Fragment>
          );
        })}

        {waitingForContent && (
          <div className="message assistant pending">Amber pisze…</div>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}
      {historyStatus === "error" && (
        <p className="error" role="alert">
          {HISTORY_LOAD_ERROR}
        </p>
      )}
      {historyStatus === "not-found" && (
        <p className="error" role="alert">
          {HISTORY_NOT_FOUND}
        </p>
      )}

      {pendingImage && (
        <div className="pending-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="thumb" src={pendingImage.url} alt={pendingImage.name} />
          <span>{pendingImage.name}</span>
          <button type="button" onClick={() => setPendingImage(null)} aria-label="Usuń zdjęcie">
            ✕
          </button>
        </div>
      )}
      {imageError && (
        <p className="error" role="alert">
          {imageError}
        </p>
      )}

      <form className="composer" onSubmit={handleSubmit}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={handleImageChange}
        />
        <button
          type="button"
          className="secondary"
          disabled={isLocked}
          onClick={() => fileInputRef.current?.click()}
        >
          Dodaj zdjęcie
        </button>
        <input
          type="text"
          placeholder="Napisz wiadomość..."
          aria-label="Wiadomość"
          value={input}
          maxLength={MAX_MESSAGE_CHARS}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={!canSend}>
          {isBusy ? "Czekaj…" : "Wyślij"}
        </button>
        {/* Lekcja 4, Warsztat 2 (Fast): Stop – tylko gdy agent wykonuje zadanie. */}
        {canStop(status) && (
          <button type="button" className="stop" onClick={() => stop()}>
            Stop
          </button>
        )}
        <button type="button" className="secondary" disabled={!canGenerate} onClick={handleGenerateImage}>
          {isGenerating ? "Generuję…" : "Wygeneruj obraz"}
        </button>
        <button type="button" className="secondary" disabled={!canAnalyze} onClick={handleAnalyze}>
          {isAnalyzing ? "Analizuję…" : "Analiza JSON"}
        </button>
      </form>

      <div className="suggestions" aria-label="Podpowiedzi opisów obrazu">
        <span>Pomysły na obraz:</span>
        {IMAGE_PROMPT_SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" disabled={isLocked} onClick={() => setInput(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>

      {input.trim().length > MAX_IMAGE_PROMPT_CHARS && input.length < SHOW_LIMIT_FROM && (
        <p className="hint" aria-live="polite">
          „Wygeneruj obraz”: opis może mieć maksymalnie {MAX_IMAGE_PROMPT_CHARS} znaków (teraz: {input.trim().length}).
        </p>
      )}

      {input.length >= SHOW_LIMIT_FROM && (
        <p className="hint" aria-live="polite">
          {input.length >= MAX_MESSAGE_CHARS
            ? `Osiągnięto limit ${MAX_MESSAGE_CHARS} znaków.`
            : `Limit wiadomości: ${input.length} / ${MAX_MESSAGE_CHARS} znaków.`}
        </p>
      )}
    </>
  );
}
