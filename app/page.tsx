export default function Home() {
  return (
    <main className="chat">
      <h1>Mój chatbot</h1>

      <div className="messages" aria-label="Rozmowa">
        {/* Tu pojawi się rozmowa */}
      </div>

      <form className="composer">
        <input type="text" placeholder="Napisz wiadomość..." aria-label="Wiadomość" />
        <button type="submit">Wyślij</button>
      </form>
    </main>
  );
}
