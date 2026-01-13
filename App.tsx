import React, { useState, useEffect, useRef } from 'react';
import { Message, Role } from './types';
import { sendMessageToGem } from './services/geminiService';
import ChatMessage from './components/ChatMessage';
import ChatInput from './components/ChatInput';
import LoadingIndicator from './components/LoadingIndicator';
import { GemIcon, UserIcon, EnterFullScreenIcon, ExitFullScreenIcon } from './components/Icons';
import SmartHomeControls from './components/SmartHomeControls';
import SpotifyControls from './components/SpotifyControls';
import YouTubeMusicControls from './components/YouTubeMusicControls';
import AvatarView from './components/AvatarView';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { SYSTEM_INSTRUCTION } from './constants';

// --- Audio Utility Functions ---
function encode(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function decode(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}

function createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}
// --- End Audio Utility Functions ---

interface TranscriptionEntry {
    speaker: 'user' | 'gem';
    text: string;
}

const App = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: Role.GEM,
      content: "[HAPPY] Hello there! I'm Gem, your new AI companion. I've been powered up and I'm practically buzzing with energy! What sort of fun are we getting into today?",
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'controls' | 'avatar'>('avatar');
  const [gemEmotion, setGemEmotion] = useState<string>('HAPPY');
  const overlayChatEndRef = useRef<HTMLDivElement>(null);

  // Live Chat State
  const [liveStatus, setLiveStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [transcriptionHistory, setTranscriptionHistory] = useState<TranscriptionEntry[]>([]);
  const [currentUserTranscription, setCurrentUserTranscription] = useState('');
  const [currentGemTranscription, setCurrentGemTranscription] = useState('');
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  
  // App container ref for fullscreen
  const appRef = useRef<HTMLDivElement>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const wakeLockSentinelRef = useRef<any | null>(null); // WakeLockSentinel type isn't available in all envs


  const cleanUpLiveChat = () => {
    console.log('Cleaning up live chat resources...');
    sessionPromiseRef.current?.then(session => session.close()).catch(console.error);
    
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current = null;
    }
    if (mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
        mediaStreamSourceRef.current = null;
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
        inputAudioContextRef.current.close().catch(console.error);
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        outputAudioContextRef.current.close().catch(console.error);
    }
    
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    analyserNodeRef.current = null;

    for (const source of audioSourcesRef.current.values()) {
        try { source.stop(); } catch (e) {}
    }
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    setLiveStatus('disconnected');
    sessionPromiseRef.current = null;
};

const playAudio = async (base64Audio: string) => {
    if (!outputAudioContextRef.current) {
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        analyserNodeRef.current = outputAudioContextRef.current.createAnalyser();
        analyserNodeRef.current.fftSize = 256;
        analyserNodeRef.current.connect(outputAudioContextRef.current.destination);
    }
    const ctx = outputAudioContextRef.current;
    const analyser = analyserNodeRef.current;
    if (!analyser) return;

    const decodedAudio = decode(base64Audio);
    const audioBuffer = await decodeAudioData(decodedAudio, ctx, 24000, 1);
    
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);

    const currentTime = ctx.currentTime;
    const startTime = Math.max(currentTime, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + audioBuffer.duration;

    audioSourcesRef.current.add(source);
    source.onended = () => audioSourcesRef.current.delete(source);
};

const startLiveChat = async () => {
    if (liveStatus !== 'disconnected' || sessionPromiseRef.current) return;
    
    setLiveStatus('connecting');
    setTranscriptionHistory([]);
    setCurrentUserTranscription('');
    setCurrentGemTranscription('');
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        sessionPromiseRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-12-2025',
            config: {
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                systemInstruction: SYSTEM_INSTRUCTION,
            },
            callbacks: {
                onopen: () => {
                    console.log('Session opened.');
                    setLiveStatus('connected');
                    if (!streamRef.current) return;
                    inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                    mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(streamRef.current);
                    scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                    scriptProcessorRef.current.onaudioprocess = (event) => {
                        const inputData = event.inputBuffer.getChannelData(0);
                        const pcmBlob = createBlob(inputData);
                        sessionPromiseRef.current?.then((session) => session.sendRealtimeInput({ media: pcmBlob }));
                    };
                    mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                },
                onmessage: async (message: LiveServerMessage) => {
                    if (message.serverContent?.inputTranscription) {
                        setCurrentUserTranscription(prev => prev + message.serverContent.inputTranscription.text);
                    }
                    if (message.serverContent?.outputTranscription) {
                        const text = message.serverContent.outputTranscription.text;
                        const emotionMatch = text.match(/\[([A-Z]+)\]/);
                        if (emotionMatch && emotionMatch[1]) setGemEmotion(emotionMatch[1]);
                        setCurrentGemTranscription(prev => prev + text);
                    }
                    if (message.serverContent?.turnComplete) {
                        setCurrentUserTranscription(prevUser => {
                            setCurrentGemTranscription(prevGem => {
                                setTranscriptionHistory(prev => [...prev, { speaker: 'user', text: prevUser }, { speaker: 'gem', text: prevGem }]);
                                return '';
                            });
                            return '';
                        });
                    }
                    const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                    if (base64Audio) await playAudio(base64Audio);
                },
                onerror: (e: ErrorEvent) => {
                    console.error('Session error:', e);
                    alert(`An error occurred: ${e.message}`);
                    cleanUpLiveChat();
                },
                onclose: () => {
                    console.log('Session closed.');
                    cleanUpLiveChat();
                },
            }
        });
    } catch (error) {
        console.error('Failed to start live chat:', error);
        alert("Could not start live chat. Please ensure you have microphone permissions.");
        cleanUpLiveChat();
    }
};

useEffect(() => {
    if (activeTab === 'avatar') {
        startLiveChat();
    } else {
        cleanUpLiveChat();
    }
    return () => { cleanUpLiveChat(); };
}, [activeTab]);


  const scrollToBottom = () => {
    overlayChatEndRef.current?.scrollIntoView({ behavior: 'auto' });
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, activeTab, transcriptionHistory, currentUserTranscription, currentGemTranscription]);

  // Effect to manage screen wake lock
  useEffect(() => {
    const acquireWakeLock = async () => {
        if ('wakeLock' in navigator) {
            try {
                wakeLockSentinelRef.current = await navigator.wakeLock.request('screen');
                console.log('Screen Wake Lock is active.');
                wakeLockSentinelRef.current.addEventListener('release', () => {
                    console.log('Screen Wake Lock was released.');
                });
            } catch (err: any) {
                console.error(`Could not acquire wake lock: ${err.name}, ${err.message}`);
            }
        } else {
            console.log('Wake Lock API is not supported by this browser.');
        }
    };

    const handleVisibilityChange = () => {
        if (wakeLockSentinelRef.current !== null && document.visibilityState === 'visible') {
            acquireWakeLock();
        }
    };

    acquireWakeLock(); // Acquire on mount

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
        if (wakeLockSentinelRef.current) {
            wakeLockSentinelRef.current.release();
            wakeLockSentinelRef.current = null;
        }
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
  
  // Effect to manage fullscreen changes
  useEffect(() => {
    const handleFullScreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
  }, []);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
        appRef.current?.requestFullscreen().catch(err => {
        alert(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    } else {
      document.exitFullscreen();
    }
  };


  const handleSendMessage = async (userInput: string) => {
    if (!userInput.trim() || isLoading) return;

    const newUserMessage: Message = { role: Role.USER, content: userInput };
    setMessages((prevMessages) => [...prevMessages, newUserMessage]);
    setIsLoading(true);

    try {
      const history = messages.map(msg => ({
        role: msg.role === Role.USER ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));

      const { text: gemResponse } = await sendMessageToGem(history, userInput);
      
      const match = gemResponse.match(/^\[([A-Z]+)\]\s*/);
      if (match && match[1]) {
        setGemEmotion(match[1]);
      }

      const newGemMessage: Message = { role: Role.GEM, content: gemResponse };
      setMessages((prevMessages) => [...prevMessages, newGemMessage]);
    } catch (error: any) {
      console.error('Error sending message to Gem:', error);
      const errorMessage: Message = {
        role: Role.GEM,
        content: "[SAD] Oh dear, something went wrong and I couldn't process your message. Please try again in a moment.",
      };
      setMessages((prevMessages) => [...prevMessages, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMiniMessage = (msg: Message, index: number) => {
    const isGem = msg.role === Role.GEM;
    let displayContent = msg.content;
    const match = msg.content.match(/^\[([A-Z]+)\]\s*/);
    if (isGem && match) {
      displayContent = msg.content.substring(match[0].length);
    }

    return (
      <div key={`mini-${index}`} className={`flex items-start gap-2 text-sm ${isGem ? 'text-purple-200' : 'text-blue-200'}`}>
        <div className="flex-shrink-0 w-5 h-5">
            {isGem ? <GemIcon className="w-full h-full" /> : <UserIcon className="w-full h-full" />}
        </div>
        <p className="flex-1 break-words">{displayContent}</p>
      </div>
    );
  }

  const renderTranscription = (entry: TranscriptionEntry, index: number) => {
    const isGem = entry.speaker === 'gem';
    const Icon = isGem ? GemIcon : UserIcon;
    const textColor = isGem ? 'text-white/90' : 'text-gray-300/90';
    
    return (
        <div key={index} className="flex items-start gap-3 text-sm">
            <div className={`w-6 h-6 flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-4 h-4 ${textColor}`} />
            </div>
            <div className="flex-1 pt-0.5">
                <p className={textColor}>{entry.text}</p>
            </div>
        </div>
    );
};


  return (
    <div ref={appRef} className="flex flex-col h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <header className="flex-shrink-0 flex items-center justify-between p-4 shadow-lg bg-gray-900/50 backdrop-blur-sm border-b border-purple-500/20 z-20">
        <div className="flex items-center">
            <GemIcon className="w-8 h-8 text-purple-400" />
            <h1 className="ml-3 text-2xl font-bold tracking-wider text-purple-300">Gem</h1>
        </div>
        {liveStatus === 'connected' && (
            <div className="flex items-center gap-2" title="Live chat is active">
                <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
                <span className="text-red-400 text-sm font-medium">LIVE</span>
            </div>
        )}
      </header>

      {/* Tabs */}
      <div className="flex-shrink-0 flex border-b border-purple-500/20 px-4 md:px-6 z-20 bg-gray-900/30">
        <button
          onClick={() => setActiveTab('avatar')}
          className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors duration-200 focus:outline-none ${
            activeTab === 'avatar'
              ? 'border-purple-400 text-purple-300'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          Avatar
        </button>
        <button
          onClick={() => setActiveTab('controls')}
          className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors duration-200 focus:outline-none ${
            activeTab === 'controls'
              ? 'border-purple-400 text-purple-300'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          Controls
        </button>
      </div>
      
      <div className="flex-1 relative overflow-hidden">
        {/* Main Content Area */}
        <div className={`absolute inset-0 transition-opacity duration-300 ${activeTab === 'controls' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="h-full overflow-y-auto p-4 md:p-6">
            <div className="space-y-4">
              <SmartHomeControls onSendCommand={handleSendMessage} isLoading={isLoading} />
              <SpotifyControls onSendCommand={handleSendMessage} isLoading={isLoading} />
              <YouTubeMusicControls onSendCommand={handleSendMessage} isLoading={isLoading} />
            </div>
          </div>
        </div>

        <div className={`absolute inset-0 bg-black transition-opacity duration-300 ${activeTab === 'avatar' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <AvatarView currentEmotion={gemEmotion} analyserNode={analyserNodeRef.current} />
            {/* Live Transcription Overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-4">
                <div className="max-w-4xl mx-auto p-4 max-h-[12.5vh] overflow-y-auto">
                    <div className="space-y-3">
                        {transcriptionHistory.map(renderTranscription)}
                        {currentUserTranscription && (
                            <div className="flex items-start gap-3 text-sm opacity-70">
                                <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"><UserIcon className="w-4 h-4 text-gray-300/90" /></div>
                                <div className="flex-1 pt-0.5"><p className="text-gray-300/90 italic">{currentUserTranscription}</p></div>
                            </div>
                        )}
                        {currentGemTranscription && (
                            <div className="flex items-start gap-3 text-sm opacity-70">
                                <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"><GemIcon className="w-4 h-4 text-white/90" /></div>
                                <div className="flex-1 pt-0.5"><p className="text-white/90 italic">{currentGemTranscription}</p></div>
                            </div>
                        )}
                         <div ref={transcriptEndRef} />
                    </div>
                </div>
            </div>
             {/* Fullscreen Button */}
             <button
                onClick={toggleFullScreen}
                className="absolute top-4 right-4 z-30 p-2 text-white/70 hover:text-white bg-black/30 rounded-full transition-colors"
                aria-label={isFullScreen ? 'Exit full screen' : 'Enter full screen'}
                title={isFullScreen ? 'Exit full screen' : 'Enter full screen'}
            >
                {isFullScreen ? <ExitFullScreenIcon className="w-6 h-6" /> : <EnterFullScreenIcon className="w-6 h-6" />}
            </button>
        </div>
      </div>
      
      {/* Chat Overlay */}
      {activeTab === 'controls' && (
          <div className="fixed bottom-4 left-4 z-10 w-full max-w-sm">
            <div className="bg-black/40 backdrop-blur-md rounded-lg shadow-2xl flex flex-col max-h-[40vh] overflow-hidden">
                <div className="flex-1 p-3 overflow-y-auto">
                    <div className="space-y-3">
                        {messages.slice(-5).map(renderMiniMessage)}
                        {isLoading && (
                           <div className="flex items-start gap-2 text-sm text-purple-200">
                             <div className="flex-shrink-0 w-5 h-5"><GemIcon className="w-full h-full" /></div>
                             <div className="flex items-center space-x-1.5 pt-1">
                                <div className="w-2 h-2 bg-purple-300 rounded-full animate-pulse [animation-delay:-0.3s]"></div>
                                <div className="w-2 h-2 bg-purple-300 rounded-full animate-pulse [animation-delay:-0.15s]"></div>
                                <div className="w-2 h-2 bg-purple-300 rounded-full animate-pulse"></div>
                              </div>
                           </div>
                        )}
                        <div ref={overlayChatEndRef} />
                    </div>
                </div>
                <div className="flex-shrink-0 p-2 border-t border-white/10">
                    <ChatInput onSendMessage={handleSendMessage} isLoading={isLoading} variant="overlay" />
                </div>
            </div>
          </div>
      )}
    </div>
  );
};

export default App;