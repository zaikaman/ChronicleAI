export function App() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, -apple-system, sans-serif",
        backgroundColor: "#0a0a0f",
        color: "#e4e4e7",
      }}
    >
      <h1
        style={{
          fontSize: "2.5rem",
          fontWeight: 700,
          marginBottom: "0.5rem",
        }}
      >
        ChronicleAI
      </h1>
      <p
        style={{
          fontSize: "1.125rem",
          color: "#a1a1aa",
          maxWidth: "480px",
          textAlign: "center",
        }}
      >
        Autonomous on-chain intelligence. Monitoring, alerting, and premium market intelligence for
        the decentralized world.
      </p>
    </main>
  );
}
