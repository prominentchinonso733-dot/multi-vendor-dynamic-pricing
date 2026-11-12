import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { io } from "socket.io-client";
import { api, BACKEND_BASE_URL, getApiErrorMessage } from "../api";
import { useAuth } from "../context/AuthContext";
import "./EscrowChat.css";

export default function EscrowChat({ contractId }) {
  const { token, user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const logRef = useRef(null);

  useEffect(() => {
    let active = true;
    const socket = io(BACKEND_BASE_URL, {
      transports: ["websocket", "polling"],
    });
    const appendMessage = (message) => {
      if (message.contractId !== contractId) return;
      setMessages((current) =>
        current.some((item) => item.id === message.id)
          ? current
          : [...current, message],
      );
    };

    api
      .get(`/escrow/${encodeURIComponent(contractId)}/messages`)
      .then(({ data }) => {
        if (!active) return;
        if (!data.success || !Array.isArray(data.messages)) {
          throw new Error("The escrow chat returned invalid message data.");
        }
        setMessages(data.messages);
      })
      .catch((loadError) => {
        if (active) {
          setError(getApiErrorMessage(loadError, "Unable to load this chat."));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    socket.on("escrow:message", appendMessage);
    socket.on("connect", () => {
      socket.emit(
        "escrow:join",
        { contractId, token },
        (result) => {
          if (active && !result?.success) {
            setError(result?.message || "Unable to join this order chat.");
          }
        },
      );
    });

    return () => {
      active = false;
      socket.disconnect();
    };
  }, [contractId, token]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending) return;

    setPending(true);
    setError("");
    try {
      const { data } = await api.post(
        `/escrow/${encodeURIComponent(contractId)}/messages`,
        { message },
      );
      if (!data.success || !data.message?.id) {
        throw new Error("The message could not be saved.");
      }
      setMessages((current) =>
        current.some((item) => item.id === data.message.id)
          ? current
          : [...current, data.message],
      );
      setDraft("");
    } catch (sendError) {
      setError(getApiErrorMessage(sendError, "Unable to send your message."));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="escrow-chat" aria-label="Order chat">
      <h3 className="escrow-chat__title">Customer and vendor chat</h3>
      <div
        aria-live="polite"
        className="escrow-chat__messages"
        ref={logRef}
        role="log"
      >
        {loading && <p className="escrow-chat__empty">Loading messages…</p>}
        {!loading && messages.length === 0 && (
          <p className="escrow-chat__empty">No messages yet. Start the conversation.</p>
        )}
        {messages.map((message) => {
          const ownMessage = String(message.senderId) === String(user?.id);
          return (
            <article
              className={`escrow-chat__message${ownMessage ? " escrow-chat__message--own" : ""}`}
              key={message.id}
            >
              <span>{ownMessage ? "You" : message.senderRole === "SELLER" ? "Vendor" : "Customer"}</span>
              <p>{message.message}</p>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString()}
              </time>
            </article>
          );
        })}
      </div>
      {error && (
        <p className="escrow-chat__error" role="alert">
          {error}
        </p>
      )}
      <form className="escrow-chat__form" onSubmit={sendMessage}>
        <label className="visually-hidden" htmlFor={`escrow-chat-${contractId}`}>
          Write a message
        </label>
        <input
          id={`escrow-chat-${contractId}`}
          maxLength={2000}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a message…"
          value={draft}
        />
        <button disabled={pending || !draft.trim()} type="submit">
          {pending ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}

EscrowChat.propTypes = {
  contractId: PropTypes.string.isRequired,
};
