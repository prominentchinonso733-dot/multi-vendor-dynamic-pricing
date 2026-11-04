import { useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { getApiErrorMessage } from "../api";
import { aiService } from "../services/aiService";
import "./AiSupportWidget.css";

export default function AiSupportWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi! I can help with marketplace FAQs, order tracking, and our refund process.",
    },
  ]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const sendMessage = async (event) => {
    event.preventDefault();
    const content = message.trim();
    if (!content || pending) return;
    const history = messages.slice(-10);
    setMessages((current) => [...current, { role: "user", content }]);
    setMessage("");
    setPending(true);
    setError("");
    try {
      const { reply, support } = await aiService.support(content, history);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: reply, support },
      ]);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "Support is unavailable right now."),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <aside className="ai-support" aria-label="AI customer support">
      {open && (
        <section
          className="ai-support__panel"
          aria-labelledby="ai-support-title"
        >
          <header className="ai-support__header">
            <div>
              <p>MARKETPLACE HELP</p>
              <h2 id="ai-support-title">Customer support</h2>
            </div>
            <button
              aria-label="Close support chat"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X size={19} />
            </button>
          </header>
          <div className="ai-support__messages" aria-live="polite">
            {messages.map((entry, index) => (
              <div
                className={`ai-support__entry ai-support__entry--${entry.role}`}
                key={`${entry.role}-${index}`}
              >
                <p
                  className={`ai-support__message ai-support__message--${entry.role}`}
                >
                  {entry.content}
                </p>
                {entry.support && (
                  <section
                    aria-label="Support classification"
                    className="ai-support__meta"
                  >
                    <strong>
                      {String(entry.support.category || "GENERAL").replaceAll(
                        "_",
                        " ",
                      )}
                    </strong>
                    <span>{entry.support.priority} priority</span>
                    {entry.support.ticketDraft && (
                      <details>
                        <summary>Dispute ticket draft</summary>
                        <p>{entry.support.ticketDraft.summary}</p>
                        <small>
                          {entry.support.ticketDraft.nextStep}{" "}
                          {entry.support.ticketDraft.note}
                        </small>
                      </details>
                    )}
                  </section>
                )}
              </div>
            ))}
            {pending && (
              <p className="ai-support__typing" role="status">
                Thinking…
              </p>
            )}
            {error && (
              <p className="ai-support__error" role="alert">
                {error}
              </p>
            )}
          </div>
          <form className="ai-support__form" onSubmit={sendMessage}>
            <label className="ai-support__sr-only" htmlFor="ai-support-message">
              Message customer support
            </label>
            <input
              id="ai-support-message"
              maxLength={1200}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask us a question..."
              value={message}
            />
            <button
              aria-label="Send message"
              disabled={pending || !message.trim()}
              type="submit"
            >
              <Send size={17} />
            </button>
          </form>
        </section>
      )}
      <button
        aria-expanded={open}
        aria-label={open ? "Close customer support" : "Open customer support"}
        className="ai-support__toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
    </aside>
  );
}
