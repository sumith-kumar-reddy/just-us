import React, { useState, useEffect, useRef, useMemo } from "react";
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams, useLocation } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { db } from "./firebase";
import { ref as dbRef, push, onValue, remove, set, update, onDisconnect } from "firebase/database";
import CryptoJS from "crypto-js";

/* ================= PRODUCTION-GRADE E2EE ================= */

// Strong key derivation using PBKDF2
const deriveKey = (roomId, password) => {
  return CryptoJS.PBKDF2(password, roomId + "secure-premium-salt-2026", {
    keySize: 256 / 32,
    iterations: 100000,
  }).toString();
};

// Encrypt with randomized IV and HMAC-SHA256 for integrity
const encrypt = (text, key) => {
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(text, CryptoJS.enc.Hex.parse(key), { iv }).toString();
  
  const payload = iv.toString() + ":" + encrypted;
  const mac = CryptoJS.HmacSHA256(payload, key).toString();
  
  return payload + ":" + mac;
};

// Safely decrypt utilizing IV and verifying HMAC
const decrypt = (data, key) => {
  try {
    if (!data) return "DECRYPTION_FAILED";
    const parts = data.split(":");
    if (parts.length !== 3) return "DECRYPTION_FAILED";

    const [ivHex, cipher, mac] = parts;
    const payload = ivHex + ":" + cipher;

    const expectedMac = CryptoJS.HmacSHA256(payload, key).toString();
    if (mac !== expectedMac) return "TAMPERED_MESSAGE";

    const bytes = CryptoJS.AES.decrypt(cipher, CryptoJS.enc.Hex.parse(key), {
      iv: CryptoJS.enc.Hex.parse(ivHex),
    });
    
    const result = bytes.toString(CryptoJS.enc.Utf8);
    return result || "DECRYPTION_FAILED";
  } catch {
    return "DECRYPTION_FAILED";
  }
};

/* ================= TYPING ANIMATION ================= */

const TypingDots = () => (
  <div style={styles.typingContainer}>
    <div style={{ ...styles.dot, animationDelay: "0s" }} />
    <div style={{ ...styles.dot, animationDelay: "0.2s" }} />
    <div style={{ ...styles.dot, animationDelay: "0.4s" }} />
  </div>
);

/* ================= HOME ================= */

function Home() {
  const navigate = useNavigate();
  const [myName, setMyName] = useState("");
  const [friendName, setFriendName] = useState("");
  const [roomPassword, setRoomPassword] = useState("");

  const handleCreateChat = () => {
    if (!myName.trim() || !friendName.trim() || !roomPassword.trim()) return;
    const roomId = uuidv4();
    const adminId = "u_" + Math.random().toString(36).substr(2, 5);
    
    // Security Fix: Store in session storage, not URL
    sessionStorage.setItem(`vault_${roomId}`, roomPassword);
    
    navigate(`/chat/${roomId}?admin=${encodeURIComponent(myName)}&guest=${encodeURIComponent(friendName)}&role=admin&uid=${adminId}`);
  };

  return (
    <div style={styles.homeContainer}>
      <style>{globalStyles}</style>
      <div style={styles.glow} />
      <div style={styles.premiumCard}>
        <div style={styles.brandBadge}>SECURE END-TO-END</div>
        <h1 style={styles.premiumTitle}>You & Me</h1>
        <p style={styles.premiumSubTitle}>Professional ephemeral messaging.</p>
        
        <div style={styles.inputGroup}>
          <input style={styles.premiumInput} placeholder="Your Name" value={myName} onChange={(e) => setMyName(e.target.value)} />
          <input style={styles.premiumInput} placeholder="Partner's Name" value={friendName} onChange={(e) => setFriendName(e.target.value)} />
          <input 
            style={{...styles.premiumInput, border: '1px solid #00ffa3'}} 
            type="password" 
            placeholder="Set Vault Password" 
            value={roomPassword} 
            onChange={(e) => setRoomPassword(e.target.value)} 
          />
          <button 
            style={{...styles.premiumButton, opacity: (myName && friendName && roomPassword) ? 1 : 0.6}} 
            onClick={handleCreateChat}
            disabled={!myName || !friendName || !roomPassword}
          >
            Open Secure Tunnel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= MEDIA COMPONENT ================= */

function MediaBubble({ msg, roomId, encryptionKey }) {
  const [showPopup, setShowPopup] = useState(false);
  const [decryptedUrl, setDecryptedUrl] = useState(null);
  const isViewOnce = msg.once === true;
  const autoDestructTimer = useRef(null);

  const handleOpenMedia = () => {
    const originalBase64 = decrypt(msg.content, encryptionKey);
    if (originalBase64 !== "DECRYPTION_FAILED" && originalBase64 !== "TAMPERED_MESSAGE") {
      setDecryptedUrl(originalBase64);
      setShowPopup(true);
      if (isViewOnce) {
        autoDestructTimer.current = setTimeout(() => {
          handleCloseAndDestroy();
        }, 60000); 
      }
    } else {
        alert("Cannot decrypt file. Wrong password or corrupted payload.");
    }
  };

  const handleCloseAndDestroy = () => {
    if (autoDestructTimer.current) clearTimeout(autoDestructTimer.current);
    if (isViewOnce) {
      remove(dbRef(db, `rooms/${roomId}/messages/${msg.key}`));
    }
    setDecryptedUrl(null);
    setShowPopup(false);
  };

  if (isViewOnce && !msg.content) {
    return <div style={styles.destructedMsg}>🔒 Content Self-Destructed</div>;
  }
  
  return (
    <>
      <div style={styles.mediaThumbnail} onClick={handleOpenMedia}>
        <div style={styles.mediaIcon}>{isViewOnce ? "👁" : "📂"}</div>
        <span style={{fontSize: '13px'}}>{isViewOnce ? "View Once Media" : "Encrypted File"}</span>
      </div>

      {showPopup && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <span style={{fontWeight:'bold'}}>{isViewOnce ? "Self-Destructing Media" : "Secure File"}</span>
              <button style={styles.closeBtn} onClick={handleCloseAndDestroy}>Close & Wipe</button>
            </div>
            <div style={styles.mediaFrame}>
              {msg.mediaType?.startsWith("image") ? (
                <img src={decryptedUrl} style={styles.fullMedia} alt="secure payload" />
              ) : (
                <video controls autoPlay src={decryptedUrl} style={styles.fullMedia} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ================= CHAT SESSION ================= */

function Chat() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  
  // Security Fix: Read from session storage
  const [vaultPassword, setVaultPassword] = useState(() => {
    return sessionStorage.getItem(`vault_${roomId}`) || "";
  });

  const encryptionKey = useMemo(() => deriveKey(roomId, vaultPassword), [roomId, vaultPassword]);

  const adminName = query.get("admin") || "Admin";
  const guestName = query.get("guest") || "Guest";
  const role = query.get("role") || "guest";
  const isAdmin = role === "admin"; 
  
  const [userId] = useState(() => {
    const saved = sessionStorage.getItem(`uid_${roomId}`);
    if (saved) return saved;
    const id = query.get("uid") || "u_" + Math.random().toString(36).substr(2, 5);
    sessionStorage.setItem(`uid_${roomId}`, id);
    return id;
  });

  const myDisplayName = isAdmin ? adminName : guestName;
  const otherDisplayName = isAdmin ? guestName : adminName;

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isOnceMode, setIsOnceMode] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [otherStatus, setOtherStatus] = useState("offline");
  const [isFull, setIsFull] = useState(false);
  
  const chatEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const lastSent = useRef(0); // Rate Limiting Ref

  // Typing Cleanup on Unmount
  useEffect(() => {
    return () => {
      set(dbRef(db, `rooms/${roomId}/typing/${userId}`), false);
    };
  }, [roomId, userId]);

  /* ===== Presence Management ===== */
  useEffect(() => {
    const presenceRef = dbRef(db, `rooms/${roomId}/presence`);
    const myPresenceRef = dbRef(db, `rooms/${roomId}/presence/${userId}`);
    
    const unsub = onValue(presenceRef, (snap) => {
      const users = snap.val() || {};
      const activeIds = Object.keys(users).filter(id => users[id] === "online");
      
      if (activeIds.length >= 2 && !activeIds.includes(userId)) {
        setIsFull(true);
      } else {
        set(myPresenceRef, "online");
        onDisconnect(myPresenceRef).set("offline");
        const otherId = Object.keys(users).find(id => id !== userId);
        if (otherId) setOtherStatus(users[otherId]);
        else setOtherStatus("offline");
      }
    });
    return () => { unsub(); set(myPresenceRef, "offline"); };
  }, [roomId, userId]);

  /* ===== Messaging, Purge, and Read Receipts ===== */
  useEffect(() => {
    if (isFull) return;
    const msgRef = dbRef(db, `rooms/${roomId}/messages`);
    const typingRef = dbRef(db, `rooms/${roomId}/typing`);

    const unsubTyping = onValue(typingRef, (snap) => {
      const data = snap.val() || {};
      const others = Object.keys(data).filter(id => id !== userId && data[id] === true);
      setIsOtherTyping(others.length > 0);
    });

    const unsubMsgs = onValue(msgRef, (snap) => {
      const data = snap.val();
      if (!data) { setMessages([]); return; }
      
      const list = Object.entries(data).map(([key, val]) => ({ key, ...val }));
      const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
      
      list.forEach(m => {
        if (m.time < twentyFourHoursAgo) {
          remove(dbRef(db, `rooms/${roomId}/messages/${m.key}`));
        }
        if (m.sender !== userId && m.status !== "seen" && document.visibilityState === "visible") {
          update(dbRef(db, `rooms/${roomId}/messages/${m.key}`), { status: "seen" });
        }
      });
      setMessages(list.filter(m => m.time >= twentyFourHoursAgo));
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        onValue(msgRef, (snap) => {
          const data = snap.val();
          if (!data) return;
          Object.entries(data).forEach(([key, m]) => {
            if (m.sender !== userId && m.status !== "seen") {
              update(dbRef(db, `rooms/${roomId}/messages/${key}`), { status: "seen" });
            }
          });
        }, { onlyOnce: true });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => { 
      unsubTyping(); 
      unsubMsgs(); 
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [roomId, userId, isFull]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isOtherTyping]);

  /* ===== Actions ===== */
  const sendTextMessage = () => {
    if (!message.trim()) return;
    
    // Rate Limiting Check
    if (Date.now() - lastSent.current < 300) return;
    lastSent.current = Date.now();

    push(dbRef(db, `rooms/${roomId}/messages`), {
      type: "text",
      content: encrypt(message, encryptionKey),
      sender: userId,
      senderName: myDisplayName,
      time: Date.now(),
      status: "sent"
    });
    setMessage("");
  };

  const deleteMsg = (msgKey) => {
    if (window.confirm("Delete this message for everyone?")) {
      remove(dbRef(db, `rooms/${roomId}/messages/${msgKey}`));
    }
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file || file.size > 10 * 1024 * 1024) return alert("File missing or too large (10MB limit)");
    setIsUploading(true);
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      push(dbRef(db, `rooms/${roomId}/messages`), {
        type: "media",
        content: encrypt(ev.target.result, encryptionKey),
        mediaType: file.type,
        sender: userId,
        senderName: myDisplayName,
        time: Date.now(),
        status: "sent",
        once: isOnceMode
      });
      setIsUploading(false);
      setIsOnceMode(false);
    };
    reader.readAsDataURL(file);
  };

  const copyInvite = () => {
    // Note: Link no longer contains the password hash
    const url = `${window.location.origin}/chat/${roomId}?admin=${adminName}&guest=${guestName}&role=guest`;
    navigator.clipboard.writeText(url);
    alert("Secure Invite Link Copied! They will need the Vault Password to enter.");
  };

  const nukeChat = () => {
    if (window.confirm("Wipe all data? This cannot be undone.")) {
      remove(dbRef(db, `rooms/${roomId}`));
      navigate("/");
    }
  };

  if (isFull) {
    return (
      <div style={styles.homeContainer}>
        <div style={styles.premiumCard}>
          <h2>Tunnel Occupied</h2>
          <button style={styles.premiumButton} onClick={() => navigate("/")}>Return Home</button>
        </div>
      </div>
    );
  }

  if (!vaultPassword) {
      return (
        <div style={styles.homeContainer}>
            <style>{globalStyles}</style>
            <div style={styles.premiumCard}>
                <h2 style={{color: '#fff', marginBottom: '20px'}}>Vault Locked</h2>
                <input 
                    style={styles.premiumInput} 
                    type="password" 
                    placeholder="Enter Vault Password" 
                    onKeyDown={(e) => {
                        if(e.key === 'Enter') {
                            setVaultPassword(e.target.value);
                            sessionStorage.setItem(`vault_${roomId}`, e.target.value);
                        }
                    }}
                />
            </div>
        </div>
      );
  }

  return (
    <div style={styles.chatWrapper}>
      <style>{globalStyles}</style>
      
      <header style={styles.premiumHeader}>
        <div style={styles.headerInfo}>
          <div style={styles.avatar}>{otherDisplayName[0]}</div>
          <div>
            <div style={styles.headerName}>{otherDisplayName}</div>
            <div style={{...styles.statusTag, color: otherStatus === 'online' ? '#00ffa3' : '#777'}}>
              {otherStatus === 'online' ? '● Secure Connection' : '○ Offline'}
            </div>
          </div>
        </div>
        <div style={styles.headerActions}>
          {isAdmin && <button onClick={copyInvite} title="Copy Link" style={styles.circleBtn}>🔗</button>}
          <button onClick={nukeChat} title="Nuke Chat" style={{...styles.circleBtn, color: '#ff4d4d'}}>✕</button>
        </div>
      </header>

      <main style={styles.messageArea}>
        <div style={styles.encryptionNotice}>🔒 HMAC-SHA256 E2EE Active • 24h Auto-Purge</div>
        {messages.map((m) => {
          const isMe = m.sender === userId;
          const decryptedContent = decrypt(m.content, encryptionKey);
          
          return (
            <div key={m.key} style={{...styles.messageRow, justifyContent: isMe ? 'flex-end' : 'flex-start'}}>
              <div style={{
                ...styles.premiumBubble, 
                backgroundColor: isMe ? '#003d33' : '#1a1a1a',
                borderBottomRightRadius: isMe ? 4 : 20,
                borderBottomLeftRadius: isMe ? 20 : 4,
                border: isMe ? '1px solid #004d40' : '1px solid #2a2a2a',
              }}>
                {isMe && <button onClick={() => deleteMsg(m.key)} style={styles.deleteBtn}>▫️</button>}
                
                {m.type === 'text' ? (
                  <div style={{...styles.bubbleText, color: (decryptedContent === "DECRYPTION_FAILED" || decryptedContent === "TAMPERED_MESSAGE") ? '#ff4d4d' : '#f0f0f0'}}>
                      {decryptedContent === "DECRYPTION_FAILED" ? "⚠️ Error: Invalid Key" : 
                       decryptedContent === "TAMPERED_MESSAGE" ? "⚠️ Message integrity compromised" : 
                       decryptedContent}
                  </div>
                ) : (
                  <MediaBubble msg={m} roomId={roomId} encryptionKey={encryptionKey} />
                )}
                
                <div style={styles.bubbleMeta}>
                  {new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                  {isMe && <span style={{marginLeft: 6}}>{m.status === 'seen' ? '✨' : ' '}</span>}
                </div>
              </div>
            </div>
          );
        })}
        
        {isOtherTyping && (
          <div style={{...styles.messageRow, justifyContent: 'flex-start'}}>
            <div style={styles.typingBubble}>
               <span style={{marginRight: '8px', opacity: 0.7}}>{otherDisplayName} is typing</span>
               <TypingDots />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </main>

      <footer style={styles.inputBar}>
        <div style={styles.inputContainer}>
          <button onClick={() => setIsOnceMode(!isOnceMode)} style={{...styles.toolBtn, color: isOnceMode ? '#ffed00' : '#666'}}>①</button>
          <label style={styles.toolBtn}>📎<input type="file" hidden onChange={handleFile} accept="image/*,video/*" /></label>
          <input 
            style={styles.mainInput} 
            placeholder={isUploading ? "Encrypting..." : "Message..."} 
            value={message}
            disabled={isUploading}
            onChange={(e) => {
                setMessage(e.target.value);
                set(dbRef(db, `rooms/${roomId}/typing/${userId}`), true);
                if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                typingTimeoutRef.current = setTimeout(() => set(dbRef(db, `rooms/${roomId}/typing/${userId}`), false), 1500);
            }}
            onKeyDown={(e) => e.key === 'Enter' && sendTextMessage()}
          />
          <button style={{
            ...styles.sendAction, 
            opacity: message.trim() ? 1 : 0.4,
            pointerEvents: message.trim() ? "auto" : "none" // UX Fix: Disabled when empty
          }} onClick={sendTextMessage}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"></line>
              <polyline points="5 12 12 5 19 12"></polyline>
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}

/* ================= APP ================= */

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/chat/:roomId" element={<Chat />} />
      </Routes>
    </Router>
  );
}

/* ================= STYLES ================= */

const globalStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; max-width: 100vw; overflow-x: hidden; background-color: #050505; }
  @keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
`;

const styles = {
  homeContainer: { height: "100dvh", width: "100%", background: "#050505", display: "flex", justifyContent: "center", alignItems: "center", position: "relative", overflow: "hidden", fontFamily: "'Inter', sans-serif" },
  glow: { position: "absolute", width: "400px", height: "400px", background: "#004d40", filter: "blur(150px)", borderRadius: "50%", top: "10%", left: "20%", opacity: 0.3 },
  premiumCard: { background: "rgba(15, 15, 15, 0.9)", backdropFilter: "blur(25px)", padding: "50px 40px", borderRadius: "40px", border: "1px solid rgba(255,255,255,0.05)", width: "90%", maxWidth: "440px", textAlign: "center", zIndex: 2 },
  brandBadge: { display: "inline-block", padding: "6px 14px", background: "rgba(0, 255, 163, 0.08)", color: "#00ffa3", borderRadius: "20px", fontSize: "11px", fontWeight: "bold", letterSpacing: "1.5px", marginBottom: "25px" },
  premiumTitle: { color: "#fff", fontSize: "40px", fontWeight: "900", margin: "0 0 10px 0", letterSpacing: "-1px" },
  premiumSubTitle: { color: "#666", fontSize: "15px", marginBottom: "40px" },
  inputGroup: { display: "flex", flexDirection: "column", gap: "15px" },
  premiumInput: { background: "#000", border: "1px solid #222", padding: "18px", borderRadius: "16px", color: "#fff", fontSize: "16px", outline: "none", width: "100%" },
  premiumButton: { background: "#fff", color: "#000", padding: "18px", borderRadius: "16px", border: "none", fontWeight: "800", cursor: "pointer", fontSize: "16px" },
  
  chatWrapper: { height: "100dvh", width: "100%", overflowX: "hidden", display: "flex", flexDirection: "column", background: "#080808", color: "#fff", fontFamily: "'Inter', sans-serif" },
  premiumHeader: { width: "100%", padding: "18px 25px", background: "rgba(8,8,8,0.9)", backdropFilter: "blur(15px)", borderBottom: "1px solid #181818", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 10 },
  headerInfo: { display: "flex", alignItems: "center", gap: "15px" },
  avatar: { width: "42px", height: "42px", background: "#004d40", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "900", color: "#00ffa3", fontSize: "18px" },
  headerName: { fontSize: "17px", fontWeight: "700" },
  statusTag: { fontSize: "11px", fontWeight: "500", marginTop: "2px" },
  headerActions: { display: "flex", gap: "12px" },
  circleBtn: { background: "#151515", border: "none", color: "#eee", width: "40px", height: "40px", borderRadius: "12px", cursor: "pointer", fontSize: "18px" },
  
  messageArea: { width: "100%", overflowX: "hidden", flex: 1, overflowY: "auto", padding: "25px", display: "flex", flexDirection: "column", gap: "20px" },
  encryptionNotice: { textAlign: "center", fontSize: "11px", color: "#444", margin: "10px 0", letterSpacing: "0.5px" },
  messageRow: { display: "flex", width: "100%" },
  premiumBubble: { maxWidth: "82%", padding: "14px 18px", position: "relative", boxShadow: "0 4px 15px rgba(0,0,0,0.2)" },
  deleteBtn: { position: 'absolute', top: '-10px', right: '-10px', background: '#222', border: '1px solid #444', borderRadius: '50%', width: '22px', height: '22px', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  bubbleText: { fontSize: "15.5px", lineHeight: "1.6" },
  bubbleMeta: { fontSize: "10px", color: "#555", marginTop: "8px", textAlign: "right", fontWeight: "500" },
  typingBubble: { background: "#151515", padding: "12px 18px", borderRadius: "18px 18px 18px 4px", fontSize: "13px", color: "#888", display: "flex", alignItems: "center", border: "1px solid #222" },
  typingContainer: { display: "flex", gap: "4px" },
  dot: { width: "6px", height: "6px", background: "#00ffa3", borderRadius: "50%", animation: "pulse 1.4s infinite ease-in-out" },
  mediaThumbnail: { background: "rgba(255,255,255,0.03)", padding: "15px", borderRadius: "14px", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", border: "1px solid #222" },
  mediaIcon: { fontSize: "22px" },
  destructedMsg: { padding: "12px", color: "#444", fontStyle: "italic", fontSize: "13px" },
  
  inputBar: { width: "100%", padding: "20px 25px 30px 25px", background: "#080808" },
  inputContainer: { background: "#121212", borderRadius: "20px", padding: "10px 15px", display: "flex", alignItems: "center", gap: "10px", border: "1px solid #222" },
  toolBtn: { background: "none", border: "none", color: "#555", fontSize: "22px", cursor: "pointer" },
  mainInput: { flex: 1, background: "none", border: "none", color: "#fff", padding: "12px 0", fontSize: "16px", outline: "none", minWidth: 0 },
  sendAction: { background: "#00ffa3", color: "#000", border: "none", width: "42px", height: "42px", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "opacity 0.2s" },
  
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.98)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center" },
  modalContent: { width: "100%", height: "100%", display: "flex", flexDirection: "column" },
  modalHeader: { padding: "25px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1a1a1a" },
  closeBtn: { background: "#e53935", color: "#fff", border: "none", padding: "10px 20px", borderRadius: "10px", fontWeight: "bold", cursor: "pointer" },
  mediaFrame: { flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "30px" },
  fullMedia: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "8px" },
};