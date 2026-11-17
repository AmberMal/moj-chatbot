import { cookies } from "next/headers";
import { SESSION_COOKIE, getAuthConfig, isSessionValid } from "../lib/auth";
import Chat from "./chat";
import LoginForm from "./login-form";

// Komponent serwerowy: sesję sprawdzamy na serwerze, zanim pokażemy czat.
export default async function Home() {
  const config = getAuthConfig();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const loggedIn = isSessionValid(token, config);

  return (
    <main className="chat">
      <header className="brand">
        <h1 className="brand-logo">Amber</h1>
        <p className="brand-tagline">Asystent Amber Security Systems Ltd – alarmy, CCTV i ochrona przeciwpożarowa</p>
      </header>
      {loggedIn ? <Chat /> : <LoginForm configured={config !== null} />}
    </main>
  );
}
