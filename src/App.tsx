import React, { useState, useRef, useEffect } from 'react';
import { Activity, AlertTriangle, Send, Loader2, Bot, User as UserIcon, LogOut, Stethoscope, Plus, MessageSquare, Search, Edit2, Check, X, Download, Upload, Settings } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { auth, db } from './firebase';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDocFromServer, setDoc, serverTimestamp } from 'firebase/firestore';

interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [customApiKey, setCustomApiKey] = useState('');

  useEffect(() => {
    const savedKey = localStorage.getItem('medassist_api_key');
    if (savedKey) setCustomApiKey(savedKey);
  }, []);

  const saveChatsLocally = (newChats: ChatSession[], uid: string) => {
    setChatSessions(newChats);
    localStorage.setItem(`medassist_chats_${uid}`, JSON.stringify(newChats));
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      setAuthLoading(false);
      
      // Test firestore connection on load
      if (user) {
        // Load local chats
        const localData = localStorage.getItem(`medassist_chats_${user.uid}`);
        if (localData) {
          try {
            setChatSessions(JSON.parse(localData));
          } catch (e) {
            console.error("Failed to parse local chats", e);
          }
        } else {
          setChatSessions([]);
        }

        try {
          // If the user logs in, we can save their profile
          const userRef = doc(db, 'users', user.uid);
          const userDoc = await getDocFromServer(userRef);
          if (!userDoc.exists()) {
            await setDoc(userRef, {
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          }
        } catch (err: any) {
          if (err instanceof Error && err.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          } else {
            console.error('Firestore Error:', err);
          }
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to login with Google.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setMessages([]);
    } catch (err) {
      console.error(err);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    
    const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: userText
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError('');

    const now = Date.now();
    let currentChatId = activeChatId;
    let newChats = [...chatSessions];

    if (!currentChatId) {
      currentChatId = now.toString();
      setActiveChatId(currentChatId);
      
      const newSession: ChatSession = {
        id: currentChatId,
        title: userText.slice(0, 30) + (userText.length > 30 ? '...' : ''),
        updatedAt: now,
        messages: [userMessage]
      };
      newChats.unshift(newSession);
    } else {
      const idx = newChats.findIndex(c => c.id === currentChatId);
      if (idx !== -1) {
        newChats[idx] = { 
          ...newChats[idx], 
          updatedAt: now, 
          messages: [...newChats[idx].messages, userMessage] 
        };
        const [updated] = newChats.splice(idx, 1);
        newChats.unshift(updated);
      }
    }
    
    if (authUser) saveChatsLocally(newChats, authUser.uid);

    try {
      // Find existing history if any (mostly for newly opened chats)
      const sessionHistory = currentChatId ? newChats.find(c => c.id === currentChatId)?.messages.slice(0, -1) || [] : [];
      
      const historyPayload = sessionHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          history: historyPayload,
          message: userText,
          apiKey: customApiKey || undefined
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error! status: ${res.status}`);
      }

      const response = await res.json();
      
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: response.text || 'No response generated.'
      };
      
      setMessages(prev => {
        const nextMessages = [...prev, aiMessage];
        
        if (authUser) {
           setChatSessions(currentChats => {
             const idx = currentChats.findIndex(c => c.id === currentChatId);
             if (idx !== -1) {
                const updatedChats = [...currentChats];
                updatedChats[idx] = {
                  ...updatedChats[idx],
                  messages: nextMessages,
                  updatedAt: Date.now()
                };
                localStorage.setItem(`medassist_chats_${authUser.uid}`, JSON.stringify(updatedChats));
                return updatedChats;
             }
             return currentChats;
           });
        }
        return nextMessages;
      });

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during communication.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setActiveChatId(null);
    setError('');
    setInput('');
  };

  const exportChat = () => {
    if (!activeChatId || messages.length === 0) return;
    
    const chatToExport = chatSessions.find(c => c.id === activeChatId);
    if (!chatToExport) return;
    
    const dataStr = JSON.stringify(chatToExport, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medassist-case-${chatToExport.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importChat = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !authUser) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedChat = JSON.parse(e.target?.result as string);
        if (importedChat.id && importedChat.messages && Array.isArray(importedChat.messages)) {
          const newId = Date.now().toString();
          const newSession: ChatSession = {
            ...importedChat,
            id: newId,
            updatedAt: Date.now(),
            title: importedChat.title + ' (Imported)'
          };
          
          const newChats = [newSession, ...chatSessions];
          saveChatsLocally(newChats, authUser.uid);
          setActiveChatId(newId);
          setMessages(newSession.messages);
        } else {
           alert("Invalid chat file format.");
        }
      } catch (err) {
        console.error("Failed to parse file", err);
        alert("Failed to read the file. Ensure it's a valid JSON export.");
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const selectChat = (chatId: string) => {
    const chat = chatSessions.find(c => c.id === chatId);
    if (!chat) return;
    
    setActiveChatId(chatId);
    setMessages(chat.messages);
    setError('');
  };

  const submitRename = (chatId: string) => {
    if (!editTitle.trim() || !authUser) {
      setEditingChatId(null);
      return;
    }
    const newChats = chatSessions.map(c => c.id === chatId ? { ...c, title: editTitle } : c);
    saveChatsLocally(newChats, authUser.uid);
    setEditingChatId(null);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white max-w-md w-full rounded-2xl shadow-xl overflow-hidden border border-slate-200">
          <div className="bg-slate-900 p-8 text-center">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <Stethoscope className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">MedAssist AI</h1>
            <p className="text-slate-400 text-sm">Advanced clinical decision support</p>
          </div>
          <div className="p-8">
            <p className="text-slate-600 text-[15px] mb-8 text-center leading-relaxed">
              Sign in with your Google account to access the secure doctor portal and begin clinical case analysis.
            </p>
            {error && (
              <div className="mb-6 bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm border border-red-200 font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            <button 
              onClick={handleLogin}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 px-4 rounded-xl transition-all shadow-sm flex items-center justify-center gap-3"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col hidden md:flex shrink-0">
        <div className="h-16 flex items-center gap-2 px-4 pt-4 shrink-0">
          <button 
            onClick={startNewChat}
            className="flex flex-1 items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-3 py-2.5 rounded-lg transition-colors border border-slate-700 font-medium text-sm shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span className="truncate">New Case</span>
          </button>
          
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={importChat}
            accept=".json"
            className="hidden" 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2.5 rounded-lg transition-colors border border-slate-700 shadow-sm shrink-0"
            title="Import Saved Case (.json)"
          >
            <Upload className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search history..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/50 text-[13px] text-slate-200 rounded-md pl-9 pr-3 py-2 border border-slate-700/50 focus:outline-none focus:border-blue-500/50 focus:bg-slate-800 transition-colors"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto px-3 pb-4 flex flex-col gap-1 min-h-0">
          <div className="text-[10px] font-bold text-slate-500 px-2 uppercase tracking-widest mb-2 mt-2">Previous Cases</div>
          
          {chatSessions.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase())).map(chat => (
            <div key={chat.id} className={`flex items-center gap-2 px-2 py-2 text-sm text-left rounded-md transition-colors group ${activeChatId === chat.id ? 'bg-slate-800 text-blue-50' : 'hover:bg-slate-800/50 text-slate-400 hover:text-slate-200'}`}>
              <MessageSquare className={`w-4 h-4 shrink-0 ${activeChatId === chat.id ? 'text-blue-400' : 'text-slate-500'}`} />
              
              {editingChatId === chat.id ? (
                <div className="flex-1 flex items-center min-w-0 bg-slate-950 rounded px-1.5 py-0.5">
                  <input 
                    type="text" 
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') submitRename(chat.id);
                      if (e.key === 'Escape') setEditingChatId(null);
                    }}
                    autoFocus
                    className="flex-1 min-w-0 bg-transparent text-sm text-white focus:outline-none"
                  />
                  <button onClick={() => submitRename(chat.id)} className="p-1 text-green-400 hover:bg-slate-800 rounded shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingChatId(null)} className="p-1 text-slate-400 hover:bg-slate-800 rounded shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={() => selectChat(chat.id)} className="flex-1 truncate text-left">
                    {chat.title}
                  </button>
                  <button 
                    onClick={() => {
                      setEditingChatId(chat.id);
                      setEditTitle(chat.title);
                    }}
                    className="p-1 text-slate-500 hover:text-white hover:bg-slate-700 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all shrink-0"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
          
          {chatSessions.length === 0 && (
            <div className="px-2 py-4 text-xs text-center text-slate-500 italic">
              No saved cases.
            </div>
          )}
        </div>
        
        <div className="p-4 border-t border-slate-800/60 bg-slate-900 shrink-0">
          <div className="flex items-center justify-between gap-2 text-slate-300">
            <div className="flex items-center gap-3">
              {authUser.photoURL ? (
                <img src={authUser.photoURL} alt="User" className="w-8 h-8 rounded-md shadow-inner" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center shadow-inner">
                  <UserIcon className="w-4 h-4 text-white" />
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <div className="text-sm font-semibold text-white truncate max-w-[120px]">{authUser.displayName || 'Doctor'}</div>
                <div className="text-[11px] text-slate-400 truncate max-w-[120px]">{authUser.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowSettings(true)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors" title="Settings">
                <Settings className="w-4 h-4" />
              </button>
              <button onClick={handleLogout} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors" title="Sign Out">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Header */}
        <header className="h-14 border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 bg-white shrink-0 z-10 shadow-sm">
          <div className="flex items-center gap-2 md:hidden">
            <button onClick={startNewChat} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md">
              <Plus className="w-5 h-5" />
            </button>
          </div>
          <div className="font-semibold text-slate-800 flex items-center gap-2">
            <span className="hidden sm:inline">MedAssist</span> AI
            <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">Pro</span>
          </div>
          <div className="flex items-center gap-3">
            {activeChatId && messages.length > 0 && (
              <button 
                onClick={exportChat}
                className="hidden md:flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 bg-white px-2.5 py-1.5 rounded-md border border-slate-200 shadow-sm transition-colors"
                title="Download conversation to your device"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
            )}
            <div className="flex md:hidden items-center">
              <button onClick={handleLogout} className="text-slate-500 text-xs font-medium">Sign Out</button>
            </div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-green-700 font-bold bg-green-50 px-2 py-1 rounded-sm border border-green-200">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
              Grounding Active
            </div>
          </div>
        </header>

        {/* Disclaimer Banner */}
        <div className="bg-amber-50/50 border-b border-amber-200/50 px-4 py-2.5 sm:px-6 shrink-0 flex items-start sm:items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
          <p className="text-[13px] font-medium text-amber-800 leading-tight">
            For medical professionals only. This AI system provides clinical decision support. Final clinical judgment rests solely with the attending physician.
          </p>
        </div>

        {/* Message View */}
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 bg-slate-50/50">
          <div className="max-w-3xl mx-auto flex flex-col gap-6">
            
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[40vh] text-center px-4 mt-8 sm:mt-16">
                <div className="w-16 h-16 bg-blue-50 flex items-center justify-center rounded-2xl mb-6 shadow-sm border border-blue-100 ring-4 ring-white">
                  <Activity className="w-8 h-8 text-blue-600" />
                </div>
                <h2 className="text-2xl font-semibold text-slate-800 mb-3 font-display">How can I assist your practice today?</h2>
                <p className="text-slate-500 max-w-lg text-[15px] mb-8 leading-relaxed">
                  Enter patient symptoms, medical history, or ask for differential diagnoses based on current clinical guidelines.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl text-left">
                  <button 
                    onClick={() => setInput("Patient is a 45yo male presenting with sudden onset chest pain radiating to the left arm, diaphoresis, and shortness of breath. No prior cardiac history. BP 150/90, HR 110. Provide differential and immediate workup.")}
                    className="border border-slate-200 bg-white rounded-xl p-4 hover:border-blue-300 hover:shadow-md transition-all group"
                  >
                    <div className="font-semibold text-slate-700 text-sm mb-1.5 group-hover:text-blue-700 transition-colors">Evaluate chest pain</div>
                    <div className="text-[13px] text-slate-500 leading-relaxed">45yo male, radiating to left arm, diaphoresis...</div>
                  </button>
                  <button 
                    onClick={() => setInput("What are the latest diagnostic criteria and recommended initial lab workup for a suspected case of Systemic Lupus Erythematosus (SLE)?")}
                    className="border border-slate-200 bg-white rounded-xl p-4 hover:border-blue-300 hover:shadow-md transition-all group"
                  >
                    <div className="font-semibold text-slate-700 text-sm mb-1.5 group-hover:text-blue-700 transition-colors">Review clinical criteria</div>
                    <div className="text-[13px] text-slate-500 leading-relaxed">SLE diagnostic guidelines and lab workup...</div>
                  </button>
                  <button 
                    onClick={() => setInput("60yo female, heavy smoker, chronic cough, recent unintentional weight loss of 10 lbs over 2 months. Mild hemoptysis noticed this morning. Recommended imaging and next steps?")}
                    className="border border-slate-200 bg-white rounded-xl p-4 hover:border-blue-300 hover:shadow-md transition-all group sm:col-span-2"
                  >
                    <div className="font-semibold text-slate-700 text-sm mb-1.5 group-hover:text-blue-700 transition-colors">Analyze complex symptoms</div>
                    <div className="text-[13px] text-slate-500 leading-relaxed">Elderly female, smoker, weight loss, hemoptysis...</div>
                  </button>
                </div>
              </div>
            ) : (
              messages.map(msg => (
                <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  
                  {msg.role === 'model' && (
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0 shadow-sm mt-1 ring-4 ring-white">
                      <Stethoscope className="w-4 h-4 text-white" />
                    </div>
                  )}

                  <div className={`max-w-[85%] sm:max-w-[75%] ${
                    msg.role === 'user' 
                      ? 'bg-slate-800 text-slate-50 rounded-2xl p-4 rounded-tr-sm shadow-sm' 
                      : 'bg-white border border-slate-200 text-slate-800 rounded-2xl p-5 shadow-sm rounded-tl-sm prose prose-sm prose-slate max-w-none markdown-body prose-a:text-blue-600 prose-headings:font-semibold prose-strong:text-slate-900'
                  }`}>
                    {msg.role === 'user' ? (
                      <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{msg.content}</div>
                    ) : (
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    )}
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center shrink-0 mt-1 ring-4 ring-white overflow-hidden">
                      {authUser?.photoURL ? (
                        <img src={authUser.photoURL} alt="User" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <UserIcon className="w-4 h-4 text-slate-600" />
                      )}
                    </div>
                  )}

                </div>
              ))
            )}

            {isLoading && (
              <div className="flex gap-4 justify-start">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0 shadow-sm mt-1 ring-4 ring-white">
                  <Stethoscope className="w-4 h-4 text-white" />
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm rounded-tl-sm flex items-center gap-3">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span className="text-[13px] font-medium text-slate-500">Synthesizing clinical literature...</span>
                </div>
              </div>
            )}

            {error && (
              <div className="flex justify-center my-2">
                <div className="bg-red-50 text-red-700 px-4 py-2.5 rounded-lg text-sm border border-red-200 font-medium shadow-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  {error}
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} className="h-2" />
          </div>
        </div>

        {/* Input Area */}
        <div className="bg-white p-4 sm:p-6 shrink-0 z-10 w-full pt-2 sm:pt-4">
          <div className="max-w-3xl mx-auto relative">
            <form onSubmit={handleSend} className="relative flex items-end shadow-sm border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 rounded-2xl overflow-hidden transition-all group">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe patient symptoms, history, or ask a clinical question..."
                className="w-full max-h-[200px] min-h-[56px] py-4 pl-4 pr-14 focus:outline-none resize-none bg-transparent text-[15px] leading-relaxed placeholder:text-slate-400"
                rows={1}
                style={{ height: "auto" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                }}
              />
              <button 
                type="submit" 
                disabled={!input.trim() || isLoading}
                className="absolute right-2 bottom-2 p-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl transition-all flex items-center justify-center shadow-sm disabled:shadow-none"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
            <div className="text-center mt-3 text-[11px] text-slate-400">
              MedAssist AI can make mistakes. Always verify information with primary medical sources and clinical judgment.
            </div>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <Settings className="w-5 h-5 text-slate-500" />
                Settings
              </h3>
              <button 
                onClick={() => setShowSettings(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Custom Gemini API Key
              </label>
              <input 
                type="password" 
                value={customApiKey}
                onChange={e => setCustomApiKey(e.target.value)}
                placeholder="AIza..."
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-shadow"
              />
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                If provided, this key will be used instead of the server default. Your key is stored locally on this device.
              </p>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 bg-slate-100 border border-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  localStorage.setItem('medassist_api_key', customApiKey);
                  setShowSettings(false);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


