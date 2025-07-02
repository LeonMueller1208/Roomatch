import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc, serverTimestamp, orderBy, limit, setDoc, getDocs } from 'firebase/firestore';
import { Search, Users, Heart, Trash2, User, Home as HomeIcon, CheckCircle, XCircle, Info, LogIn, LogOut, Copy, MessageSquareText } from 'lucide-react';

// Tailwind CSS wird geladen. Dieses Skript-Tag wird normalerweise im <head>-Bereich der public/index.html-Datei platziert.
// Für die Canvas-Umgebung wird davon ausgegangen, dass es verfügbar oder injiziert ist.
// <script src="https://cdn.tailwindcss.com"></script>

// Firebase Konfiguration
const firebaseConfig = {
    apiKey: "AIzaSyACGoSxD0_UZhWg06gzZjaifBn3sI06YGg", // <--- API KEY HIER AKTUALISIERT!
    authDomain: "mvp-roomatch.firebaseapp.com",
    projectId: "mvp-roomatch",
    storageBucket: "mvp-roomatch.firebasestorage.app",
    messagingSenderId: "190918526277",
    appId: "1:190918526277:web:268e07e2f1f326b8e86a2c",
    measurementId: "G-5JPWLD0ZC"
};

// Vordefinierte Listen für Persönlichkeitsmerkmale und Interessen
const allPersonalityTraits = ['tidy', 'calm', 'social', 'creative', 'sporty', 'night owl', 'early bird', 'tolerant', 'animal lover', 'flexible', 'structured'];
const allInterests = ['Cooking', 'Movies', 'Music', 'Games', 'Nature', 'Sports', 'Reading', 'Travel', 'Partying', 'Gaming', 'Plants', 'Culture', 'Art'];
const allCommunalLivingPreferences = ['very tidy', 'rather relaxed', 'prefers weekly cleaning schedules', 'spontaneous tidying', 'often cook together', 'sometimes cook together', 'rarely cook together'];
const allWGValues = ['sustainability important', 'open communication preferred', 'respect for privacy', 'shared activities important', 'prefers quiet home', 'prefers lively home', 'politically engaged', 'culturally interested'];

// **WICHTIG:** ERSETZEN SIE DIESEN WERT GENAU DURCH IHRE TATSÄCHTLICHE ADMIN-UID, DIE NACH ERFOLGREICHEM GOOGLE-LOGIN IN DER APP ANGEZEIGT WIRD!
const ADMIN_UID = "hFt4BLSEg0UYAAUSfdf404mfw5v2"; // Platzhalter: Bitte geben Sie hier Ihre Admin-ID ein!

// Hilfsfunktion zum sicheren Parsen von Zahlen
const safeParseInt = (value) => parseInt(value) || 0;

// Hilfsfunktion zum Großschreiben des ersten Buchstabens für die Anzeige
const capitalizeFirstLetter = (string) => {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
};

// Hilfsfunktion zum Abrufen eines konsistent sortierten Arrays von Teilnehmer-UIDs
// Dies ist entscheidend für die Abfrage von 1:1-Chats in Firestore
const getSortedParticipantsUids = (uid1, uid2) => {
    const uids = [uid1, uid2];
    uids.sort(); // Sortiert alphabetisch, um eine konsistente Chat-Dokument-ID zu gewährleisten
    return uids;
};


// Funktion zur Berechnung des Übereinstimmungs-Scores zwischen einem Suchenden- und einem Zimmerprofil
// Gibt jetzt ein Objekt mit Gesamtpunktzahl und einer detaillierten Aufschlüsselung zurück
const calculateMatchScore = (seeker, room) => {
    let totalScore = 0;
    // Details mit allen möglichen Kategorien und Standardwerten initialisieren
    const details = {
        ageMatch: { score: 0, description: `Altersübereinstimmung (N/A)` },
        genderMatch: { score: 0, description: `Geschlechtspräferenz (N/A)` },
        personalityTraits: { score: 0, description: `Persönlichkeitsüberschneidung (Keine)` },
        interests: { score: 0, description: `Interessenüberschneidung (Keine)` },
        rentMatch: { score: 0, description: `Mietübereinstimmung (N/A)` },
        petsMatch: { score: 0, description: `Haustierkompatibilität (N/A)` },
        freeTextMatch: { score: 0, description: `Freitext-Schlüsselwörter (Keine)` },
        avgAgeDifference: { score: 0, description: `Durchschnittlicher Altersunterschied (N/A)` },
        communalLiving: { score: 0, description: `Präferenzen für das Zusammenleben (Keine)` },
        values: { score: 0, description: `Gemeinsame Werte (Keine)` },
    };

    const getArrayValue = (profile, field) => {
        const value = profile[field];
        return Array.isArray(value) ? value : (value ? String(value).split(',').map(s => s.trim()) : []);
    };

    // Feste Gewichtungen für die Übereinstimmungskriterien definieren
    const MATCH_WEIGHTS = {
        ageMatch: 2.0,       // Alter ist doppelt so wichtig
        genderMatch: 1.0,    // Geschlecht ist normalerweise wichtig
        personalityTraits: 1.5, // Persönlichkeitsmerkmale sind 1,5-mal so wichtig
        interests: 0.5,      // Interessen sind halb so wichtig
        rentMatch: 2.5,      // Miete ist 2,5-mal so wichtig
        petsMatch: 1.2,      // Haustiere sind etwas wichtiger
        freeTextMatch: 0.2,  // Freitext hat geringe Bedeutung
        avgAgeDifference: 1.0, // Altersunterschied (negativer Beitrag)
        communalLiving: 1.8, // Präferenzen für das Zusammenleben sind wichtig
        values: 2.0          // Werte sind doppelt so wichtig
    };

    // 1. Altersübereinstimmung (Alter des Suchenden vs. Altersbereich des Zimmers)
    const seekerAge = safeParseInt(seeker.age);
    const roomMinAge = safeParseInt(room?.minAge);
    const roomMaxAge = safeParseInt(room?.maxAge);
    let ageScore = 0;
    let ageDescription = `Altersübereinstimmung (Suchender: ${seeker.age || 'N/A'}, Zimmer: ${room?.minAge || 'N/A'}-${room?.maxAge || 'N/A'})`;

    if (seekerAge > 0 && roomMinAge > 0 && roomMaxAge > 0) {
        if (seekerAge >= roomMinAge && seekerAge <= roomMaxAge) {
            ageScore = 20 * MATCH_WEIGHTS.ageMatch;
        } else {
            const ageDiffLow = Math.max(0, roomMinAge - seekerAge);
            const ageDiffHigh = Math.max(0, seekerAge - roomMaxAge);
            ageScore = -(ageDiffLow + ageDiffHigh) * MATCH_WEIGHTS.ageMatch * 0.5;
        }
    }
    details.ageMatch = { score: ageScore, description: ageDescription };
    totalScore += ageScore;

    // 2. Geschlechtspräferenz - Wenn die spezifische Präferenz nicht übereinstimmt, einen disqualifizierenden Score zurückgeben
    let genderScore = 0;
    let genderDescription = `Geschlechtspräferenz (Suchender: ${capitalizeFirstLetter(seeker.gender || 'N/A')}, Zimmer: ${capitalizeFirstLetter(room?.genderPreference || 'N/A')})`;
    if (seeker.gender && room?.genderPreference) {
        if (room.genderPreference !== 'any' && seeker.gender !== room.genderPreference) {
            return { totalScore: -999999, details: { ...details, genderMatch: { score: -999999, description: "Geschlechts-Fehlübereinstimmung (Disqualifiziert)" } } };
        } else if (room.genderPreference === 'any' || seeker.gender === room.genderPreference) {
            genderScore = 10 * MATCH_WEIGHTS.genderMatch;
        }
    }
    details.genderMatch = { score: genderScore, description: genderDescription };
    totalScore += genderScore;

    // 3. Persönlichkeitsmerkmale (Überschneidung)
    const seekerTraits = getArrayValue(seeker, 'personalityTraits');
    const roomTraits = getArrayValue(room, 'personalityTraits');
    const commonTraits = seekerTraits.filter(trait => roomTraits.includes(trait));
    let personalityScore = commonTraits.length * 5 * MATCH_WEIGHTS.personalityTraits;
    details.personalityTraits = { score: personalityScore, description: `Persönlichkeitsüberschneidung (${commonTraits.map(capitalizeFirstLetter).join(', ') || 'Keine'})` };
    totalScore += personalityScore;

    // 4. Interessen (Überschneidung)
    const seekerInterests = getArrayValue(seeker, 'interests');
    const roomInterests = getArrayValue(room, 'interests');
    const commonInterests = seekerInterests.filter(interest => roomInterests.includes(interest));
    let interestsScore = commonInterests.length * 3 * MATCH_WEIGHTS.interests;
    totalScore += interestsScore;
    details.interests = { score: interestsScore, description: `Interessenüberschneidung (${commonInterests.map(capitalizeFirstLetter).join(', ') || 'Keine'})` };

    // 5. Miete (Max. Miete des Suchenden >= Miete des Zimmers)
    const seekerMaxRent = safeParseInt(seeker.maxRent);
    const roomRent = safeParseInt(room?.rent);
    let rentScore = 0;
    let rentDescription = `Mietübereinstimmung (Max: ${seeker.maxRent || 'N/A'}€, Zimmer: ${room?.rent || 'N/A'}€)`;

    if (seekerMaxRent > 0 && roomRent > 0) {
        if (seekerMaxRent >= roomRent) {
            rentScore = 15 * MATCH_WEIGHTS.rentMatch;
        } else {
            rentScore = -(roomRent - seekerMaxRent) * MATCH_WEIGHTS.rentMatch * 0.2;
        }
    }
    details.rentMatch = { score: rentScore, description: rentDescription };
    totalScore += rentScore;

    // 6. Haustiere (Übereinstimmung)
    let petsScore = 0;
    let petsDescription = `Haustierkompatibilität (Suchender: ${capitalizeFirstLetter(seeker.pets || 'N/A')}, Zimmer: ${capitalizeFirstLetter(room?.petsAllowed || 'N/A')})`;
    if (seeker.pets && room?.petsAllowed) {
        if (seeker.pets === 'yes' && room.petsAllowed === 'yes') {
            petsScore = 8 * MATCH_WEIGHTS.petsMatch;
        } else if (seeker.pets === 'yes' && room.petsAllowed === 'no') {
            petsScore = -20 * MATCH_WEIGHTS.petsMatch;
        } else if (seeker.pets === 'no' && room.petsAllowed === 'yes') {
            petsScore = 0;
        } else if (seeker.pets === 'no' && room.petsAllowed === 'no') {
            petsScore = 5 * MATCH_WEIGHTS.petsMatch;
        }
    }
    details.petsMatch = { score: petsScore, description: petsDescription };
    totalScore += petsScore;

    // 7. Freitext 'lookingFor' (Suchender) vs. 'description'/'lookingForInFlatmate' (Zimmer)
    const seekerLookingFor = (seeker.lookingFor || '').toLowerCase();
    const roomDescription = (room?.description || '').toLowerCase();
    const roomLookingForInFlatmate = (room?.lookingForInFlatmate || '').toLowerCase();

    const seekerKeywords = seekerLookingFor.split(' ').filter(word => word.length > 2);
    const matchedKeywords = [];
    seekerKeywords.forEach(keyword => {
        if (roomDescription.includes(keyword) || roomLookingForInFlatmate.includes(keyword)) {
            matchedKeywords.push(keyword);
        }
    });
    let freeTextScore = matchedKeywords.length * 1 * MATCH_WEIGHTS.freeTextMatch;
    totalScore += freeTextScore;
    details.freeTextMatch = { score: freeTextScore, description: `Freitext-Schlüsselwörter (${matchedKeywords.map(capitalizeFirstLetter).join(', ') || 'Keine'})` };
    
    // 8. Durchschnittliches Alter der Zimmerbewohner im Vergleich zum Alter des Suchenden
    const seekerAgeAvg = safeParseInt(seeker.age);
    const roomAvgAge = safeParseInt(room?.avgAge);
    let avgAgeDiffScore = 0;
    let avgAgeDescription = `Durchschnittlicher Altersunterschied (Suchender: ${seeker.age || 'N/A'}, Zimmer-Durchschnitt: ${room?.avgAge || 'N/A'})`;
    if (seekerAgeAvg > 0 && roomAvgAge > 0) {
        avgAgeDiffScore = -Math.abs(seekerAgeAvg - roomAvgAge) * MATCH_WEIGHTS.avgAgeDifference;
    }
    details.avgAgeDifference = { score: avgAgeDiffScore, description: avgAgeDescription };
    totalScore += avgAgeDiffScore;

    // 9. Neu: Präferenzen für das Zusammenleben
    const seekerCommunalPrefs = getArrayValue(seeker, 'communalLivingPreferences');
    const roomCommunalPrefs = getArrayValue(room, 'roomCommunalLiving');
    const commonCommunalPrefs = seekerCommunalPrefs.filter(pref => roomCommunalPrefs.includes(pref));
    let communalLivingScore = commonCommunalPrefs.length * 7 * MATCH_WEIGHTS.communalLiving;
    totalScore += communalLivingScore;
    details.communalLiving = { score: communalLivingScore, description: `Präferenzen für das Zusammenleben (${commonCommunalPrefs.map(capitalizeFirstLetter).join(', ') || 'Keine'})` };

    // 10. Neu: Werte
    const seekerValues = getArrayValue(seeker, 'values');
    const roomValues = getArrayValue(room, 'roomValues');
    const commonValues = seekerValues.filter(val => roomValues.includes(val));
    let valuesScore = commonValues.length * 10 * MATCH_WEIGHTS.values;
    totalScore += valuesScore;
    details.values = { score: valuesScore, description: `Gemeinsame Werte (${commonValues.map(capitalizeFirstLetter).join(', ') || 'Keine'})` };

    return { totalScore, details };
};

// Hilfsfunktion zum Abrufen der Farbklasse basierend auf dem Score
const getScoreColorClass = (score) => {
    if (score >= 100) {
        return 'bg-green-200 text-green-800';
    } else if (score >= 50) {
        return 'bg-yellow-200 text-yellow-800';
    } else if (score >= 0) {
        return 'bg-orange-200 text-orange-800';
    } else {
        return 'bg-red-200 text-red-800';
    }
};

// Modal-Komponente zur Anzeige von Übereinstimmungsdetails
const MatchDetailsModal = ({ isOpen, onClose, seeker, room, matchDetails }) => {
    if (!isOpen || !seeker || !room || !matchDetails) return null;

    const detailsEntries = matchDetails.details ? Object.entries(matchDetails.details) : [];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md max-h-[90vh] overflow-y-auto relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
                >
                    <XCircle size={24} />
                </button>
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-4 text-center">Übereinstimmungsdetails</h2>
                <p className="text-base sm:text-lg font-semibold mb-2">
                    <span className="text-[#5a9c68]">Suchender:</span> {seeker.name}
                </p>
                <p className="text-base sm:text-lg font-semibold mb-4">
                    <span className="text-[#cc8a2f]">Zimmerangebot:</span> {room.name}
                </p>

                <div className={`mt-2 mb-6 px-4 py-2 rounded-full text-lg sm:text-xl font-bold text-center ${getScoreColorClass(matchDetails.totalScore)}`}>
                    Gesamtpunktzahl: {matchDetails.totalScore !== undefined && matchDetails.totalScore !== null ? matchDetails.totalScore.toFixed(0) : 'N/A'}
                </div>

                <h3 className="text-xl text-gray-700 mb-3">Score-Aufschlüsselung:</h3>
                <ul className="space-y-3">
                    {detailsEntries.map(([key, value]) => (
                        <li key={key} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg text-xs">
                            <span className="font-medium text-gray-700">{value?.description || key}:</span>
                            <span className={`font-bold ${value?.score !== undefined && value.score !== null && value.score >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {value?.score !== undefined && value.score !== null ? value.score.toFixed(1) : 'N/A'}
                            </span>
                        </li>
                    ))}
                </ul>

                <div className="mt-8 text-center">
                    <button
                        onClick={onClose}
                        className="px-6 py-3 bg-gray-300 text-gray-800 font-bold rounded-xl shadow-md hover:bg-gray-400 transition duration-150 ease-in-out"
                    >
                        Schließen
                    </button>
                </div>
            </div>
        </div>
    );
};

// Komponente für die Chat-Liste
const ChatList = ({ chats, onSelectChat, currentUserUid }) => {
    return (
        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-xl w-full max-w-xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-6 text-center">Meine Chats</h2>
            {chats.length === 0 ? (
                <p className="text-center text-gray-600">Noch keine aktiven Chats. Starten Sie einen Chat aus Ihren Matches!</p>
            ) : (
                <div className="space-y-3">
                    {chats.map(chat => (
                        <div
                            key={chat.id}
                            className="flex items-center justify-between p-4 bg-gray-50 rounded-lg shadow-sm cursor-pointer hover:bg-gray-100 transition"
                            onClick={() => onSelectChat(chat.id)}
                        >
                            <div className="flex-1">
                                <p className="font-semibold text-gray-800">
                                    Chat mit: {chat.participants.find(p => p.uid !== currentUserUid)?.name || 'Unbekannter Benutzer'}
                                </p>
                                {chat.initialContext && ( // Display initial context in chat list
                                    <p className="text-xs text-blue-600 mt-1">
                                        Über: {chat.initialContext.profileName} ({capitalizeFirstLetter(chat.initialContext.type === 'room' ? 'Zimmer' : 'Suchprofil')})
                                    </p>
                                )}
                                {chat.lastMessage && (
                                    <p className="text-sm text-gray-600 truncate">
                                        {chat.lastMessage.senderId === currentUserUid ? 'Du: ' : ''}
                                        {chat.lastMessage.text}
                                    </p>
                                )}
                            </div>
                            <span className="text-xs text-gray-500 ml-4">
                                {chat.lastMessageTimestamp ? new Date(chat.lastMessageTimestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Komponente für die Chat-Konversation
const ChatConversation = ({ selectedChatId, onCloseChat, currentUserUid, otherUser, db, currentUserName }) => {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [chatInitialContext, setChatInitialContext] = useState(null); // NEU: Zustand für initialen Chat-Kontext
    const messagesEndRef = useRef(null); // Ref zum Scrollen nach unten

    // Nachrichten für den ausgewählten Chat abrufen
    useEffect(() => {
        if (!db || !selectedChatId) return;

        const chatDocRef = doc(db, 'chats', selectedChatId);
        const messagesRef = collection(db, 'chats', selectedChatId, 'messages');
        const q = query(messagesRef, orderBy('timestamp'), limit(50)); // Auf die letzten 50 Nachrichten beschränken

        // Listener für das Chat-Dokument selbst, um initialContext abzurufen
        const unsubscribeChatDoc = onSnapshot(chatDocRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                setChatInitialContext(docSnapshot.data().initialContext || null);
            }
        }, (error) => {
            console.error("Fehler beim Abrufen des Chat-Dokuments:", error);
        });

        // Listener für Nachrichten
        const unsubscribeMessages = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMessages(msgs);
        }, (error) => {
            console.error("Fehler beim Abrufen von Nachrichten:", error);
            // In einer echten App dem Benutzer einen Fehler anzeigen
        });

        return () => {
            unsubscribeChatDoc();
            unsubscribeMessages();
        };
    }, [db, selectedChatId]);

    // Zum neuesten Nachricht scrollen, wenn sich Nachrichten aktualisieren
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages]);

    const handleSendMessage = async () => {
        if (newMessage.trim() === '' || !db || !selectedChatId || !currentUserUid) return;

        try {
            const messagesRef = collection(db, 'chats', selectedChatId, 'messages');
            await addDoc(messagesRef, {
                senderId: currentUserUid,
                text: newMessage,
                timestamp: serverTimestamp(), // Server-Timestamp für Konsistenz verwenden
            });
            setNewMessage('');

            // Optional: lastMessage und lastMessageTimestamp im übergeordneten Chat-Dokument aktualisieren
            // Dies ist ein gängiges Muster für Chat-Listen-Vorschauen
            const chatDocRef = doc(db, 'chats', selectedChatId);
            await setDoc(chatDocRef, {
                lastMessage: {
                    senderId: currentUserUid,
                    text: newMessage,
                },
                lastMessageTimestamp: serverTimestamp(),
            }, { merge: true }); // Merge verwenden, um nur diese Felder zu aktualisieren
            
        } catch (error) {
            console.error("Fehler beim Senden der Nachricht:", error);
            // In einer echten App dem Benutzer einen Fehler anzeigen
        }
    };

    return (
        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-xl w-full max-w-xl mx-auto flex flex-col h-[70vh]">
            <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-200">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800">
                    Chat mit: {otherUser?.name || 'Unbekannter Benutzer'}
                </h2>
                <button onClick={onCloseChat} className="text-gray-500 hover:text-gray-700">
                    <XCircle size={24} />
                </button>
            </div>

            {chatInitialContext && ( // NEU: Initialen Kontext anzeigen
                <div className="bg-blue-50 text-blue-800 p-3 rounded-lg mb-4 text-sm text-center">
                    Dieser Chat wurde über das {chatInitialContext.type === 'room' ? 'Zimmerangebot' : 'Suchprofil'} "
                    <span className="font-semibold">{chatInitialContext.profileName}</span>" gestartet.
                </div>
            )}

            <div className="flex-1 overflow-y-auto mb-4 space-y-3 p-2 bg-gray-50 rounded-lg">
                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex ${msg.senderId === currentUserUid ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`px-4 py-2 rounded-lg max-w-[75%] ${
                                msg.senderId === currentUserUid
                                    ? 'bg-[#d0f6f0] text-gray-800' // Helleres Grün für den Absender
                                    : 'bg-gray-200 text-gray-800'
                            }`}
                        >
                            <p className="font-semibold text-sm mb-1">
                                {msg.senderId === currentUserUid ? currentUserName : otherUser?.name || 'Unbekannter Benutzer'}
                            </p>
                            <p className="text-sm">{msg.text}</p>
                            {msg.timestamp && (
                                <span className="block text-right text-xs text-gray-500 mt-1">
                                    {new Date(msg.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} /> {/* Dummy-Div zum Scrollen */}
            </div>

            <div className="flex">
                <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                            handleSendMessage();
                        }
                    }}
                    placeholder="Nachricht eingeben..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1]"
                />
                <button
                    onClick={handleSendMessage}
                    className="px-6 py-2 bg-[#3fd5c1] text-white font-bold rounded-r-lg shadow-md hover:bg-[#32c0ae] transition"
                >
                    Senden
                </button>
            </div>
        </div>
    );
};

// Haupt-Chat-Seitenkomponente (wird bedingt in App.js gerendert)
const ChatPage = ({ db, currentUserUid, currentUserName, allSearcherProfilesGlobal, allRoomProfilesGlobal, initialChatTargetUid, setInitialChatTargetUid, initialChatTargetProfileId, setInitialChatTargetProfileId, initialChatTargetProfileName, setInitialChatTargetProfileName, initialChatTargetProfileType, setInitialChatTargetProfileType }) => {
    const [chats, setChats] = useState([]);
    const [selectedChatId, setSelectedChatId] = useState(null);
    const [otherUser, setOtherUser] = useState(null);
    const [isLoadingChat, setIsLoadingChat] = useState(false);
    const [chatError, setChatError] = useState(null);

    // Alle Profile (Suchende und Zimmer) kombinieren und UIDs Namen zuordnen
    // Diese memoized Map ist entscheidend für die Anzeige von Namen in der Chat-Liste/Konversation
    const allProfilesMap = useMemo(() => {
        const map = {};
        // Den Anzeigenamen des aktuellen Benutzers aus der Authentifizierung priorisieren
        if (currentUserUid && currentUserName) {
            map[currentUserUid] = currentUserName;
        }

        // Alle Profile durchlaufen. Wenn ein Benutzer bereits einen Namen in der Map hat (z. B. vom aktuellen Benutzernamen),
        // oder wenn ein Name bereits durch ein früheres Profil gesetzt wurde, nicht überschreiben.
        [...allSearcherProfilesGlobal, ...allRoomProfilesGlobal].forEach(profile => {
            if (profile.createdBy && profile.name && !map[profile.createdBy]) { // Nur setzen, wenn noch nicht vorhanden
                map[profile.createdBy] = profile.name;
            }
        });
        return map;
    }, [allSearcherProfilesGlobal, allRoomProfilesGlobal, currentUserUid, currentUserName]); // Abhängigkeiten für Memoization

    // Effekt 1: Initialen Chat-Ziel behandeln (beim Klicken auf Chat-Button von einem Match)
    // Dieser Effekt läuft, wenn sich initialChatTargetUid, currentUserUid oder db ändern.
    // Er findet oder erstellt einen Chat und setzt die selectedChatId.
    useEffect(() => {
        const findOrCreateChat = async () => {
            // Nur fortfahren, wenn wir eine Ziel-UID, die UID des aktuellen Benutzers und eine bereitstehende DB haben
            // Außerdem sicherstellen, dass nicht erneut ausgelöst wird, wenn bereits ein Chat ausgewählt oder geladen wird
            if (!db || !currentUserUid || !initialChatTargetUid || selectedChatId || isLoadingChat) return;

            setIsLoadingChat(true);
            setChatError(null);
            console.log("ChatPage: Versuche, Chat mit Ziel-Benutzer-UID zu finden oder zu erstellen:", initialChatTargetUid, "für Profil:", initialChatTargetProfileName);


            try {
                const chatsRef = collection(db, 'chats');
                const participantUids = getSortedParticipantsUids(currentUserUid, initialChatTargetUid);

                // Nach bestehendem Chat abfragen, bei dem das participantsUids-Array exakt übereinstimmt
                const q = query(
                    chatsRef,
                    where('participantsUids', '==', participantUids)
                );

                const querySnapshot = await getDocs(q);

                let chatToSelectId = null;
                if (!querySnapshot.empty) {
                    // Chat existiert, auswählen
                    chatToSelectId = querySnapshot.docs[0].id;
                    console.log("ChatPage: Bestehender Chat mit ID gefunden:", chatToSelectId);
                } else {
                    // Chat existiert nicht, neuen erstellen
                    const newChatRef = await addDoc(chatsRef, {
                        participantsUids: participantUids, // Sortierte UIDs speichern
                        createdAt: serverTimestamp(),
                        lastMessageTimestamp: serverTimestamp(), // Timestamp für Sortierung initialisieren
                        // NEU: Kontext des Profils hinzufügen
                        initialContext: {
                            profileId: initialChatTargetProfileId,
                            profileName: initialChatTargetProfileName,
                            type: initialChatTargetProfileType,
                            initiatorUid: currentUserUid // Wer den Chat initiiert hat
                        },
                        lastMessage: {
                            senderId: currentUserUid,
                            text: `Ich bin an Ihrem ${initialChatTargetProfileType === 'room' ? 'Zimmerangebot' : 'Suchprofil'} '${initialChatTargetProfileName}' interessiert.`,
                        },
                    });
                    chatToSelectId = newChatRef.id;
                    console.log("ChatPage: Neuer Chat mit ID erstellt:", chatToSelectId);
                }

                setSelectedChatId(chatToSelectId);
                const otherUserName = allProfilesMap[initialChatTargetUid] || 'Unbekannter Benutzer';
                setOtherUser({ uid: initialChatTargetUid, name: otherUserName });
                console.log("ChatPage: Chat gestartet mit:", otherUserName, "(UID:", initialChatTargetUid, ") über Profil:", initialChatTargetProfileName);


            } catch (error) {
                console.error("Fehler beim Suchen oder Erstellen des Chats:", error);
                setChatError("Chat konnte nicht gestartet werden. Bitte versuchen Sie es erneut.");
            } finally {
                setIsLoadingChat(false);
                // WICHTIG: initialChatTargetUid und Profil-Kontext in der übergeordneten App-Komponente löschen
                // Dies verhindert, dass dieser Effekt unnötigerweise erneut ausgeführt wird, wenn ChatPage neu gerendert wird
                // und initialChatTargetUid von einer früheren Navigation noch gesetzt ist.
                setInitialChatTargetUid(null);
                setInitialChatTargetProfileId(null); // Neu
                setInitialChatTargetProfileName(null); // Neu
                setInitialChatTargetProfileType(null); // Neu
            }
        };

        // Diesen Effekt nur auslösen, wenn initialChatTargetUid explizit von der übergeordneten App gesetzt wird
        // und andere Bedingungen (db, currentUserUid) erfüllt sind.
        if (initialChatTargetUid && currentUserUid && db) {
            findOrCreateChat();
        }
    }, [db, currentUserUid, initialChatTargetUid, initialChatTargetProfileId, initialChatTargetProfileName, initialChatTargetProfileType, allProfilesMap, selectedChatId, isLoadingChat, setInitialChatTargetUid, setInitialChatTargetProfileId, setInitialChatTargetProfileName, setInitialChatTargetProfileType]);

    // Effekt 2: Chats des Benutzers für die Listenansicht abrufen
    // Dieser Effekt hängt nur von den Kerndaten ab, die zum Abrufen der Chat-Liste benötigt werden.
    useEffect(() => {
        if (!db || !currentUserUid) return;

        const chatsRef = collection(db, 'chats');
        // Chats abfragen, bei denen der aktuelle Benutzer ein Teilnehmer ist
        const q = query(
            chatsRef,
            where('participantsUids', 'array-contains', currentUserUid),
            orderBy('lastMessageTimestamp', 'desc') // Nach letzter Nachricht für Chat-Liste sortieren
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedChats = snapshot.docs.map(doc => {
                const data = doc.data();
                // Sicherstellen, dass Teilnehmer ein Array von Objekten mit uid und name ist
                const participantsWithNames = data.participantsUids.map(uid => ({
                    uid: uid,
                    name: allProfilesMap[uid] || 'Unbekannter Benutzer' // Abgerufene Profilnamen verwenden
                }));
                return {
                    id: doc.id,
                    ...data,
                    participants: participantsWithNames,
                };
            });
            setChats(fetchedChats);
            console.log("ChatPage: Chat-Liste abgerufen. Anzahl der Chats:", fetchedChats.length);
        }, (error) => {
            console.error("Fehler beim Abrufen von Chats:", error);
            setChatError("Fehler beim Laden Ihrer Chats.");
        });

        return () => unsubscribe();
    }, [db, currentUserUid, allProfilesMap]); // initialChatTargetUid, selectedChatId aus Abhängigkeiten entfernt

    const handleSelectChat = (chatId) => {
        setSelectedChatId(chatId);
        const selectedChat = chats.find(chat => chat.id === chatId);
        if (selectedChat) {
            // Das Profil des anderen Teilnehmers finden
            const otherParticipantUid = selectedChat.participants.find(p => p.uid !== currentUserUid)?.uid;
            const otherUserName = allProfilesMap[otherParticipantUid] || 'Unbekannter Benutzer';
            setOtherUser({ uid: otherParticipantUid, name: otherUserName });
            console.log("ChatPage: Bestehender Chat ausgewählt. Anderer Benutzer:", otherUserName, "(UID:", otherParticipantUid, ")");
        }
    };

    const handleCloseChat = () => {
        setSelectedChatId(null);
        setOtherUser(null);
        // Beim Schließen eines Chats auch initialChatTargetUid in App.js löschen
        // Dies ist wichtig, wenn der Benutzer von einem bestimmten Chat, der über einen "Chat starten"-Button initiiert wurde,
        // zur Chat-Liste zurücknavigiert.
        setInitialChatTargetUid(null); // WICHTIG: Dies in der übergeordneten App-Komponente löschen
        setInitialChatTargetProfileId(null); // Neu
        setInitialChatTargetProfileName(null); // Neu
        setInitialChatTargetProfileType(null); // Neu
        console.log("ChatPage: Chat geschlossen.");
    };

    if (isLoadingChat) {
        return (
            <div className="flex items-center justify-center h-[50vh] text-gray-700 text-lg animate-pulse">
                Chat wird geladen...
            </div>
        );
    }

    if (chatError) {
        return (
            <div className="flex items-center justify-center h-[50vh] bg-red-100 text-red-700 p-4 rounded-lg">
                <p>Chat-Fehler: {chatError}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
            {!selectedChatId ? (
                <ChatList
                    chats={chats}
                    onSelectChat={handleSelectChat}
                    currentUserUid={currentUserUid}
                />
            ) : (
                <ChatConversation
                    selectedChatId={selectedChatId}
                    onCloseChat={handleCloseChat}
                    currentUserUid={currentUserUid}
                    otherUser={otherUser}
                    db={db}
                    currentUserName={currentUserName}
                />
            )}
        </div>
    );
};


// Hauptkomponente der Roommatch-Anwendung
function App() {
    const [mySearcherProfiles, setMySearcherProfiles] = useState([]);
    const [myRoomProfiles, setMyRoomProfiles] = useState([]);
    const [allSearcherProfilesGlobal, setAllSearcherProfilesGlobal] = useState([]);
    const [allRoomProfilesGlobal, setAllRoomProfilesGlobal] = useState([]);

    const [matches, setMatches] = useState([]);
    const [reverseMatches, setReverseMatches] = useState([]);
    
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null); // Firebase Auth Instanz
    const [userId, setUserId] = useState(null);
    const [userName, setUserName] = useState(null); // Zustand für den Benutzernamen
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showSeekerForm, setShowSeekerForm] = useState(true);
    const [saveMessage, setSaveMessage] = useState(''); // Der Inhalt der Nachricht
    const [showSaveMessageElement, setShowSaveMessageElement] = useState(false); // Steuert die Deckkraft/Sichtbarkeit des festen Elements
    const [adminMode, setAdminMode] = useState(false);
    const [selectedMatchDetails, setSelectedMatchDetails] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false); // Neuer Zustand zur Verfolgung der Authentifizierungsbereitschaft
    const [showUserIdCopied, setShowUserIdCopied] = useState(false); // Zustand für die Kopiernachricht
    const [scrollToProfileId, setScrollToProfileId] = useState(null); // Neuer Zustand zum Scrollen zu einem bestimmten Profil

    // Neuer Zustand für die aktuelle Ansicht: 'home' (Standardprofilerstellung/Matches), 'chats', 'admin'
    const [currentView, setCurrentView] = useState('home');
    const [initialChatTargetUid, setInitialChatTargetUid] = useState(null); // UID des Benutzers, mit dem direkt gechattet werden soll
    // NEU: Zustände für den initialen Profilkontext beim Chat-Start
    const [initialChatTargetProfileId, setInitialChatTargetProfileId] = useState(null);
    const [initialChatTargetProfileName, setInitialChatTargetProfileName] = useState(null);
    const [initialChatTargetProfileType, setInitialChatTargetProfileType] = useState(null);

    // Firebase-Initialisierung und Authentifizierung
    useEffect(() => {
        let appInstance, dbInstance, authInstance;

        try {
            appInstance = initializeApp(firebaseConfig);
            dbInstance = getFirestore(appInstance);
            authInstance = getAuth(appInstance);

            setDb(dbInstance);
            setAuth(authInstance);

            const unsubscribeAuth = onAuthStateChanged(authInstance, (user) => {
                if (user) {
                    setUserId(user.uid);
                    setUserName(user.displayName || user.email || 'Gast');
                    setAdminMode(user.uid === ADMIN_UID);
                } else {
                    // Kein Benutzer angemeldet. Auf explizite Google-Anmeldung warten.
                    setUserId(null);
                    setUserName(null);
                    setAdminMode(false);
                }
                setIsAuthReady(true); // Authentifizierungssystem ist bereit, unabhängig vom Anmeldestatus
                setLoading(false); // Laden beendet
            });

            return () => {
                unsubscribeAuth();
            };
        } catch (initError) {
            console.error("Fehler bei der Firebase-Initialisierung:", initError);
            setError("Firebase konnte nicht initialisiert werden. Bitte überprüfen Sie Ihre Firebase-Konfiguration und Internetverbindung.");
            setLoading(false);
        }
    }, []);

    // Effekt zum Scrollen zu einem bestimmten Profil, nachdem es hinzugefügt/gerendert wurde
    useEffect(() => {
        if (scrollToProfileId) {
            const element = document.getElementById(`profile-${scrollToProfileId}`);
            if (element) {
                // Eine kleine Verzögerung verwenden, um sicherzustellen, dass das DOM nach der Zustandsänderung aktualisiert wurde
                setTimeout(() => {
                    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    // Nur löschen, wenn die aktuelle scrollToProfileId übereinstimmt,
                    // falls eine neue Scroll-Anforderung sehr schnell eingegangen ist.
                    setScrollToProfileId(currentId => currentId === scrollToProfileId ? null : currentId);
                }, 100); // 100ms Verzögerung
            }
        }
    }, [scrollToProfileId]); // Abhängigkeiten enthalten jetzt nur scrollToProfileId

    // Effekt zur Handhabung der Anzeige und des Ausblendens der Speicher-Nachricht
    useEffect(() => {
        let timerFadeOut;
        let timerClearContent;

        if (saveMessage) {
            setShowSaveMessageElement(true); // Element sofort sichtbar machen

            // Nach 2 Sekunden mit dem Ausblenden beginnen
            timerFadeOut = setTimeout(() => {
                setShowSaveMessageElement(false);
            }, 2000); // Nachricht ist 2 Sekunden lang vollständig sichtbar

            // Den Nachrichteninhalt löschen, nachdem der Ausblendübergang abgeschlossen ist (2000ms + 500ms Übergang = 2500ms insgesamt)
            timerClearContent = setTimeout(() => {
                setSaveMessage('');
            }, 2500); // Den tatsächlichen Nachrichteninhalt löschen, nachdem die Animation visuell abgeschlossen ist

        } else {
            // Wenn saveMessage leer wird (z. B. vom Anfangszustand oder explizit an anderer Stelle gelöscht),
            // sicherstellen, dass das Element ausgeblendet ist und keine Timer ausstehen.
            setShowSaveMessageElement(false); // Sicherstellen, dass es ausgeblendet ist, wenn saveMessage leer ist
        }

        return () => {
            clearTimeout(timerFadeOut);
            clearTimeout(timerClearContent);
        };
    }, [saveMessage]); // Nur von saveMessage abhängig


    // Funktion für die Google-Anmeldung
    const handleGoogleSignIn = async () => {
        if (!auth) {
            setError("Authentifizierungsdienst nicht bereit.");
            return;
        }
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            setError(null);
        } catch (error) {
            console.error("Google-Anmeldefehler:", error);
            // Verbesserte Fehlermeldung für ungültigen API-Schlüssel
            if (error.code === 'auth/api-key-not-valid') {
                setError("Anmeldung fehlgeschlagen: Der Firebase API-Schlüssel ist ungültig. Bitte überprüfen Sie ihn in der Firebase Console.");
            } else {
                setError("Google-Anmeldung fehlgeschlagen: " + error.message);
            }
        }
    };

    // Funktion zum Abmelden
    const handleSignOut = async () => {
        if (!auth) {
            setError("Authentifizierungsdienst nicht bereit zum Abmelden.");
            return;
        }
        try {
            await signOut(auth);
            setUserId(null);
            setUserName(null);
            setAdminMode(false);
            setError(null);
            setCurrentView('home'); // Ansicht beim Abmelden zurücksetzen
            setInitialChatTargetUid(null); // Zielbenutzer beim Abmelden löschen
            setInitialChatTargetProfileId(null); // Neu
            setInitialChatTargetProfileName(null); // Neu
            setInitialChatTargetProfileType(null); // Neu
        } catch (error) {
            console.error("Abmeldefehler:", error);
            setError("Abmeldung fehlgeschlagen: " + error.message);
        }
    };

    // Funktion zum Kopieren der UID in die Zwischenablage
    const copyUidToClipboard = () => {
        if (userId) {
            // document.execCommand für iFrame-Kompatibilität verwenden
            const textArea = document.createElement("textarea");
            textArea.value = userId;
            textArea.style.position = "fixed"; // Vermeidet Scrollen nach unten
            textArea.style.opacity = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                setShowUserIdCopied(true);
                setTimeout(() => setShowUserIdCopied(false), 2000);
            } catch (err) {
                console.error('Fallback: Ups, konnte nicht kopieren', err);
                // In einer echten App könnte hier stattdessen eine benutzerfreundliche Nachricht angezeigt werden
            } finally {
                document.body.removeChild(textArea);
            }
        }
    };


    // Wenn der Admin-Modus umgeschaltet wird, sicherstellen, dass das Formular auf 'Suchprofil' zurückgesetzt wird
    useEffect(() => {
        if (!adminMode) {
            setShowSeekerForm(true);
            setCurrentView('home'); // Zurück zur Startansicht, wenn der Admin-Modus deaktiviert ist
            setInitialChatTargetUid(null); // Zielbenutzer löschen
            setInitialChatTargetProfileId(null); // Neu
            setInitialChatTargetProfileName(null); // Neu
            setInitialChatTargetProfileType(null); // Neu
        }
    }, [adminMode]);

    // Hilfsfunktion zum Abrufen des Sammlungs-Pfades (vereinfacht für Sammlungen auf Root-Ebene gemäß den Regeln)
    const getCollectionRef = useCallback((collectionName) => {
        if (!db) {
            console.warn("Versuch, Sammlungsreferenz abzurufen, bevor Firestore DB initialisiert wurde.");
            return null;
        }
        return collection(db, collectionName);
    }, [db]);


    // Echtzeit-Datenabruf für *eigene* Suchprofile aus Firestore
    useEffect(() => {
        // Nur abrufen, wenn DB bereit, Authentifizierung bereit und ein Benutzer angemeldet ist
        if (!db || !userId || !isAuthReady) return;
        let unsubscribe;
        const timer = setTimeout(() => {
            const collectionRef = getCollectionRef(`searcherProfiles`);
            if (!collectionRef) {
                console.error("Sammlungsreferenz für Suchprofile ist nach Verzögerung null.");
                return;
            }
            const mySearchersQuery = query(collectionRef, where('createdBy', '==', userId));
            unsubscribe = onSnapshot(mySearchersQuery, (snapshot) => {
                const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setMySearcherProfiles(profiles);
            }, (err) => {
                console.error("Fehler beim Abrufen eigener Suchprofile:", err);
                setError("Fehler beim Laden eigener Suchprofile.");
            });
        }, 100);

        return () => {
            clearTimeout(timer);
            if (unsubscribe) unsubscribe();
        };
    }, [db, userId, isAuthReady, getCollectionRef]);

    const [myNewRoomProfilesData, setMyNewRoomProfilesData] = useState([]); 
    const [myOldWgProfilesData, setMyOldWgProfilesData] = useState([]);

    // Echtzeit-Datenabruf für *eigene* Zimmerprofile aus Firestore
    useEffect(() => {
        // Nur abrufen, wenn DB bereit, Authentifizierung bereit und ein Benutzer angemeldet ist
        if (!db || !userId || !isAuthReady) return;
        let unsubscribeMyNewRooms;
        let unsubscribeMyOldWgs;

        const timer = setTimeout(() => {
            // Aus 'roomProfiles' (neu) abrufen
            const newRoomsCollectionRef = getCollectionRef(`roomProfiles`);
            if (newRoomsCollectionRef) {
                const myRoomsQuery = query(newRoomsCollectionRef, where('createdBy', '==', userId));
                unsubscribeMyNewRooms = onSnapshot(myRoomsQuery, (snapshot) => {
                    const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), isLegacy: false }));
                    setMyNewRoomProfilesData(profiles);
                }, (err) => {
                    console.error("Fehler beim Abrufen eigener neuer Zimmerprofile:", err);
                    setError("Fehler beim Laden eigener Zimmerprofile.");
                });
            } else {
                console.error("Sammlungsreferenz für roomProfiles ist nach Verzögerung null.");
            }

            // Aus 'wgProfiles' (alt) abrufen
            const oldWgsCollectionRef = getCollectionRef(`wgProfiles`);
            if (oldWgsCollectionRef) {
                const myWgsQuery = query(oldWgsCollectionRef, where('createdBy', '==', userId));
                unsubscribeMyOldWgs = onSnapshot(myWgsQuery, (snapshot) => {
                    const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), isLegacy: true }));
                    setMyOldWgProfilesData(profiles);
                }, (err) => {
                    console.error("Fehler beim Abrufen eigener alter WG-Profile:", err);
                });
            } else {
                console.error("Sammlungsreferenz für wgProfiles ist nach Verzögerung null.");
            }
        }, 100);

        return () => {
            clearTimeout(timer);
            if (unsubscribeMyNewRooms) unsubscribeMyNewRooms();
            if (unsubscribeMyOldWgs) unsubscribeMyOldWgs();
        };
    }, [db, userId, isAuthReady, getCollectionRef]);

    useEffect(() => {
        setMyRoomProfiles([...myNewRoomProfilesData, ...myOldWgProfilesData]);
    }, [myNewRoomProfilesData, myOldWgProfilesData]);

    const [newRoomProfilesData, setNewRoomProfilesData] = useState([]);
    const [oldWgProfilesData, setOldWgProfilesData] = useState([]);

    // Echtzeit-Datenabruf für *alle* Suchprofile (für die Übereinstimmungsberechnung)
    useEffect(() => {
        // Nur abrufen, wenn DB bereit, Authentifizierung bereit und ein Benutzer angemeldet ist (oder Admin-Modus)
        // Wenn die Authentifizierung nicht bereit ist oder der Benutzer nicht angemeldet ist, sollten diese Listener nicht aktiv sein
        if (!db || !isAuthReady || (!userId && !adminMode)) {
            setAllSearcherProfilesGlobal([]); // Globale Profile löschen, wenn nicht zum Abrufen autorisiert
            return;
        }; 
        let unsubscribe;
        const timer = setTimeout(() => {
            const collectionRef = getCollectionRef(`searcherProfiles`);
            if (!collectionRef) {
                console.error("Sammlungsreferenz für alle Suchprofile ist nach Verzögerung null.");
                return;
            }
            const allSearchersQuery = query(collectionRef);
            unsubscribe = onSnapshot(allSearchersQuery, (snapshot) => {
                const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setAllSearcherProfilesGlobal(profiles);
            }, (err) => {
                console.error("Fehler beim Abrufen aller Suchprofile (global):", err);
            });
        }, 100);

        return () => {
            clearTimeout(timer);
            if (unsubscribe) unsubscribe();
        };
    }, [db, userId, isAuthReady, adminMode, getCollectionRef]); // userId und adminMode zu Abhängigkeiten hinzugefügt

    // Echtzeit-Datenabruf für *alle* Zimmerprofile (für die Übereinstimmungsberechnung - Kombination neuer und alter Sammlungen)
    useEffect(() => {
        // Nur abrufen, wenn DB bereit, Authentifizierung bereit und ein Benutzer angemeldet ist (oder Admin-Modus)
        // Wenn die Authentifizierung nicht bereit ist oder der Benutzer nicht angemeldet ist, sollten diese Listener nicht aktiv sein
        if (!db || !isAuthReady || (!userId && !adminMode)) {
            setNewRoomProfilesData([]); // Globale Profile löschen, wenn nicht zum Abrufen autorisiert
            setOldWgProfilesData([]); // Globale Profile löschen, wenn nicht zum Abrufen autorisiert
            return;
        };
        let unsubscribeNewRooms;
        let unsubscribeOldWgs;

        const timer = setTimeout(() => {
            // Aus 'roomProfiles' (neu) abrufen
            const newRoomsCollectionRef = getCollectionRef(`roomProfiles`);
            if (newRoomsCollectionRef) {
                const roomProfilesQuery = query(newRoomsCollectionRef);
                unsubscribeNewRooms = onSnapshot(roomProfilesQuery, (roomSnapshot) => {
                    const profiles = roomSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), isLegacy: false }));
                    setNewRoomProfilesData(profiles);
                }, (err) => {
                    console.error("Fehler beim Abrufen aller Zimmerprofile (neue Sammlung):", err);
                });
            } else {
                console.error("Sammlungsreferenz für roomProfiles (global) ist nach Verzögerung null.");
            }

            // Aus 'wgProfiles' (alt) abrufen
            const oldWgsCollectionRef = getCollectionRef(`wgProfiles`);
            if (oldWgsCollectionRef) {
                const wgProfilesQuery = query(oldWgsCollectionRef);
                unsubscribeOldWgs = onSnapshot(wgProfilesQuery, (wgSnapshot) => {
                    const profiles = wgSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), isLegacy: true }));
                    setOldWgProfilesData(profiles);
                }, (err) => {
                    console.error("Fehler beim Abrufen aller Zimmerprofile (alte WG-Sammlung):", err);
                });
            } else {
                console.error("Sammlungsreferenz für wgProfiles (global) ist nach Verzögerung null.");
            }
        }, 100);

        return () => {
            clearTimeout(timer);
            if (unsubscribeNewRooms) unsubscribeNewRooms();
            if (unsubscribeOldWgs) unsubscribeOldWgs();
        };
    }, [db, userId, isAuthReady, adminMode, getCollectionRef]); // userId und adminMode zu Abhängigkeiten hinzugefügt

    useEffect(() => {
        setAllRoomProfilesGlobal([...newRoomProfilesData, ...oldWgProfilesData]);
    }, [newRoomProfilesData, oldWgProfilesData]);

    // Übereinstimmungsberechnung für beide Richtungen
    useEffect(() => {
        const calculateAllMatches = () => {
            const newSeekerToRoomMatches = [];
            // Matches werden nur für angemeldete Benutzer oder im Admin-Modus berechnet
            const seekersForMatching = (adminMode || userId) ? allSearcherProfilesGlobal : [];
            
            seekersForMatching.forEach(searcher => {
                const matchingRooms = allRoomProfilesGlobal.map(room => {
                    const matchResult = calculateMatchScore(searcher, room);
                    return { room: room, score: matchResult.totalScore, breakdownDetails: matchResult.details, fullMatchResult: matchResult };
                }).filter(match => match.score > -999998); // Disqualifizierende Matches herausfiltern
                
                matchingRooms.sort((a, b) => b.score - a.score);
                newSeekerToRoomMatches.push({ searcher: searcher, matchingRooms: matchingRooms.slice(0, 10) });
            });
            setMatches(newSeekerToRoomMatches);

            const newRoomToSeekerMatches = [];
            const roomsForMatching = (adminMode || userId) ? allRoomProfilesGlobal : [];

            roomsForMatching.forEach(room => {
                const matchingSeekers = allSearcherProfilesGlobal.map(searcher => {
                    const matchResult = calculateMatchScore(searcher, room);
                    return { searcher, score: matchResult.totalScore, breakdownDetails: matchResult.details, fullMatchResult: matchResult };
                }).filter(match => match.score > -999998); // Disqualifizierende Matches herausfiltern
                
                matchingSeekers.sort((a, b) => b.score - a.score);
                newRoomToSeekerMatches.push({ room: room, matchingSeekers: matchingSeekers.slice(0, 10) });
            });
            setReverseMatches(newRoomToSeekerMatches);
        };

        // Matches nur berechnen, wenn DB bereit, Authentifizierung bereit UND Benutzer angemeldet oder im Admin-Modus ist
        if (db && isAuthReady && (userId || adminMode)) {
            calculateAllMatches();
        } else {
            // Matches löschen, wenn nicht zum Berechnen/Anzeigen autorisiert
            setMatches([]);
            setReverseMatches([]);
        }
    }, [allSearcherProfilesGlobal, allRoomProfilesGlobal, adminMode, userId, db, isAuthReady]);

    // Funktion zum Hinzufügen eines Suchprofils zu Firestore
    const addSearcherProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Datenbank nicht bereit oder nicht angemeldet. Bitte warten Sie oder melden Sie sich an.");
            return;
        }
        try {
            const collectionRef = getCollectionRef(`searcherProfiles`);
            if (!collectionRef) {
                setError("Konnte keine Sammlungsreferenz für Suchprofile erhalten.");
                return;
            }
            const docRef = await addDoc(collectionRef, {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId, // Profil mit USER_ID verknüpfen
            });
            setSaveMessage('Suchprofil erfolgreich gespeichert!');
            setScrollToProfileId(docRef.id); // ID zum Scrollen festlegen
            setShowSeekerForm(true); // Sicherstellen, dass der Suchformular-Tab nach der Erstellung aktiv ist
        } catch (e) {
            console.error("Fehler beim Hinzufügen des Suchprofils: ", e);
            setError("Fehler beim Speichern des Suchprofils.");
        }
    };

    // Funktion zum Hinzufügen eines Zimmerprofils zu Firestore
    const addRoomProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Datenbank nicht bereit oder nicht angemeldet. Bitte warten Sie oder melden Sie sich an.");
            return;
        }
        try {
            const collectionRef = getCollectionRef(`roomProfiles`);
            if (!collectionRef) {
                setError("Konnte keine Sammlungsreferenz für Zimmerprofile erhalten.");
                return;
            }
            const docRef = await addDoc(collectionRef, {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId, // Profil mit USER_ID verknüpfen
            });
            setSaveMessage('Zimmerprofil erfolgreich gespeichert!');
            setScrollToProfileId(docRef.id); // ID zum Scrollen festlegen
            setShowSeekerForm(false); // Sicherstellen, dass der Zimmerformular-Tab nach der Erstellung aktiv ist
        } catch (e) {
            console.error("Fehler beim Hinzufügen des Zimmerprofils: ", e);
            setError("Fehler beim Speichern des Zimmerprofils.");
        }
    };

    // Funktion zum Löschen eines Profils
    const handleDeleteProfile = async (collectionName, docId, profileName, profileCreatorId) => {
        if (!db || !userId) {
            setError("Datenbank nicht bereit zum Löschen oder nicht angemeldet.");
            return;
        }

        if (!adminMode && userId !== profileCreatorId) {
            setError("Sie sind nicht berechtigt, dieses Profil zu löschen.");
            setTimeout(() => setError(''), 3000);
            return;
        }

        try {
            const collectionRef = getCollectionRef(collectionName);
            if (!collectionRef) {
                setError(`Konnte keine Sammlungsreferenz für ${collectionName} erhalten.`);
                return;
            }
            await deleteDoc(doc(collectionRef, docId));
            setSaveMessage(`Profil "${profileName}" erfolgreich gelöscht!`);
        } catch (e) {
            console.error(`Fehler beim Löschen des Profils ${profileName}: `, e);
            setError(`Fehler beim Löschen des Profils "${profileName}".`);
        }
    };

    // Funktion zum Navigieren zum Chat mit einem bestimmten Benutzer (dessen Profil-UID)
    // Jetzt mit zusätzlichen Parametern für den Kontext des Profils
    const handleStartChat = useCallback((targetUserUid, targetProfileId, targetProfileName, typeOfTargetProfile) => {
        if (!userId) {
            setError("Bitte melden Sie sich an, um einen Chat zu starten.");
            return;
        }
        if (userId === targetUserUid) {
            setError("Sie können nicht mit sich selbst chatten.");
            setTimeout(() => setError(''), 3000); // Fehler nach 3 Sekunden löschen
            return;
        }
        console.log("App: Calling handleStartChat with targetUserUid:", targetUserUid, "Target Profile ID:", targetProfileId, "Target Profile Name:", targetProfileName, "Type:", typeOfTargetProfile);
        // Setzen der initialen Chat-Ziel-Informationen
        setInitialChatTargetUid(targetUserUid);
        setInitialChatTargetProfileId(targetProfileId); // Neu
        setInitialChatTargetProfileName(targetProfileName); // Neu
        setInitialChatTargetProfileType(typeOfTargetProfile); // Neu
        setCurrentView('chats'); // Zur Chat-Ansicht wechseln
    }, [userId]); // Abhängigkeiten aktualisiert

    // Vereinheitlichte Profilformular-Komponente
    const ProfileForm = ({ onSubmit, type }) => {
        const [currentStep, setCurrentStep] = useState(1);
        const totalSteps = 3;
        const [showGenderTooltip, setShowGenderTooltip] = useState(false);

        const [formState, setFormState] = useState({
            name: '',
            age: '', minAge: '', maxAge: '',
            gender: 'male', genderPreference: 'any',
            personalityTraits: [],
            interests: [],
            maxRent: '', pets: 'any', lookingFor: '',
            description: '', rent: '', roomType: 'Single Room', petsAllowed: 'any',
            avgAge: '', lookingForInFlatmate: '',
            location: 'Cologne',
            communalLivingPreferences: [],
            roomCommunalLiving: [],
            values: [],
            roomValues: [],
        });

        const handleChange = (e) => {
            const { name, value, type, checked } = e.target;
            if (type === 'checkbox') {
                const currentValues = formState[name] || [];
                if (checked) {
                    setFormState({ ...formState, [name]: [...currentValues, value] });
                } else {
                    setFormState({ ...formState, [name]: currentValues.filter((item) => item !== value) });
                }
            } else {
                setFormState({ ...formState, [name]: value });
            }
        };

        const nextStep = () => {
            setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
        };

        const prevStep = () => {
            setCurrentStep((prev) => Math.max(prev - 1, 1));
        };

        const handleCancel = () => {
            setFormState({
                name: '', age: '', minAge: '', maxAge: '', gender: 'male',
                genderPreference: 'any', personalityTraits: [], interests: [],
                maxRent: '', pets: 'any', lookingFor: '', description: '', rent: '',
                roomType: 'Single Room', petsAllowed: 'any', avgAge: '',
                lookingForInFlatmate: '', location: 'Cologne',
                communalLivingPreferences: [], roomCommunalLiving: [], values: [], roomValues: []
            });
            setCurrentStep(1);
        };

        const handleSubmit = async () => {
            const dataToSubmit = { ...formState };
            dataToSubmit.age = safeParseInt(dataToSubmit.age); 
            dataToSubmit.minAge = safeParseInt(dataToSubmit.minAge);
            dataToSubmit.maxAge = safeParseInt(dataToSubmit.maxAge);
            dataToSubmit.maxRent = safeParseInt(dataToSubmit.maxRent);
            dataToSubmit.rent = safeParseInt(dataToSubmit.rent);
            dataToSubmit.avgAge = safeParseInt(dataToSubmit.avgAge);

            await onSubmit(dataToSubmit);
            setFormState({
                name: '', age: '', minAge: '', maxAge: '', gender: 'male',
                genderPreference: 'any', personalityTraits: [], interests: [],
                maxRent: '', pets: 'any', lookingFor: '', description: '', rent: '',
                roomType: 'Single Room', petsAllowed: 'any', avgAge: '',
                lookingForInFlatmate: '', location: 'Cologne',
                communalLivingPreferences: [], roomCommunalLiving: [], values: [], roomValues: []
            });
            setCurrentStep(1);
        };

        return (
            <form className="p-8 bg-white rounded-2xl shadow-xl space-y-4 sm:space-y-6 w-full max-w-xl mx-auto transform transition-all duration-300 hover:scale-[1.01]">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-800 mb-4 sm:mb-6 text-center">
                    {type === 'seeker' ? `Suchprofil erstellen (Schritt ${currentStep}/${totalSteps})` : `Zimmerangebot erstellen (Schritt ${currentStep}/${totalSteps})`}
                </h2>

                {/* --- SCHRITT 1 --- */}
                {currentStep === 1 && (
                    <div className="space-y-4">
                        {/* Name / Zimmername */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">
                                {type === 'seeker' ? 'Ihr Name:' : 'Zimmername:'}
                            </label>
                            <input
                                type="text"
                                name="name"
                                value={formState.name}
                                onChange={handleChange}
                                required
                                className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                            />
                        </div>

                        {/* Alter (Suchender) / Altersbereich (Anbieter) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Ihr Alter:</label>
                                <input
                                    type="number"
                                    name="age"
                                    value={formState.age}
                                    onChange={handleChange}
                                    required
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                />
                            </div>
                        )}
                        {type === 'provider' && (
                            <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-4 sm:space-y-0">
                                <div className="flex-1">
                                    <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Min. Mitbewohner-Alter:</label>
                                    <input
                                        type="number"
                                        name="minAge"
                                        value={formState.minAge}
                                        onChange={handleChange}
                                        required
                                        className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Max. Mitbewohner-Alter:</label>
                                    <input
                                        type="number"
                                        name="maxAge"
                                        value={formState.maxAge}
                                        onChange={handleChange}
                                        required
                                        className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Geschlecht (Suchender) / Geschlechtspräferenz (Anbieter) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Ihr Geschlecht:</label>
                                <select
                                    name="gender"
                                    value={formState.gender}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                >
                                    <option value="male">Männlich</option>
                                    <option value="female">Weiblich</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2 flex items-center">
                                    Geschlechtspräferenz für Mitbewohner:
                                    <div
                                        className="relative ml-2 cursor-pointer text-red-500 hover:text-red-700"
                                        onMouseEnter={() => setShowGenderTooltip(true)}
                                        onMouseLeave={() => setShowGenderTooltip(false)}
                                    >
                                        <Info size={18} />
                                        {showGenderTooltip && (
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 max-w-[calc(100vw-2rem)] p-3 bg-red-100 text-red-800 text-sm rounded-lg shadow-lg z-10 border border-red-300 sm:left-full sm:translate-x-0 sm:ml-2 sm:mt-0">
                                                Die Auswahl "Männlich" oder "Weiblich" schließt Suchende des anderen Geschlechts von Ihren Suchergebnissen aus.
                                            </div>
                                        )}
                                    </div>
                                </label>
                                <select
                                    name="genderPreference"
                                    value={formState.genderPreference}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                >
                                    <option value="any">Beliebig</option>
                                    <option value="male">Männlich</option>
                                    <option value="female">Weiblich</option>
                                </select>
                            </div>
                        )}

                        {/* Ort / Stadtteil (für beide) */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Ort / Stadtteil:</label>
                            <select
                                name="location"
                                value={formState.location}
                                onChange={handleChange}
                                required
                                className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                            >
                                <option value="Cologne">Köln</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* --- SCHRITT 2 --- */}
                {currentStep === 2 && (
                    <div className="space-y-4">
                        {/* Maximale Miete (Suchender) / Miete (Anbieter) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Maximale Miete (€):</label>
                                <input
                                    type="number"
                                    name="maxRent"
                                    value={formState.maxRent}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                />
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Miete (€):</label>
                                <input
                                    type="number"
                                    name="rent"
                                    value={formState.rent}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                />
                            </div>
                        )}

                        {/* Haustiere (Suchender) / Haustiere erlaubt (Anbieter) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Haustiere:</label>
                                <select
                                    name="pets"
                                    value={formState.pets}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                >
                                    <option value="any">Beliebig</option>
                                    <option value="yes">Ja</option>
                                    <option value="no">Nein</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Haustiere erlaubt:</label>
                                <select
                                    name="petsAllowed"
                                    value={formState.petsAllowed}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                >
                                    <option value="any">Beliebig</option>
                                    <option value="yes">Ja</option>
                                    <option value="no">Nein</option>
                                </select>
                            </div>
                        )}

                        {/* Persönlichkeitsmerkmale (für beide) */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">
                                {type === 'seeker' ? 'Ihre Persönlichkeitsmerkmale:' : 'Persönlichkeitsmerkmale der aktuellen Bewohner:'}
                            </label>
                            <div className="grid grid-cols-2 gap-2 sm:gap-3 p-3 border border-gray-300 rounded-lg bg-gray-50">
                                {allPersonalityTraits.map(trait => (
                                    <label key={trait} className="inline-flex items-center text-gray-800 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            name="personalityTraits"
                                            value={trait}
                                            checked={formState.personalityTraits.includes(trait)}
                                            onChange={handleChange}
                                            className="form-checkbox h-4 w-4 sm:h-5 sm:w-5 text-[#3fd5c1] rounded focus:ring-2 focus:ring-[#3fd5c1]"
                                        />
                                        <span className="ml-2 text-xs sm:text-sm">{capitalizeFirstLetter(trait)}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Interessen (für beide) */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">
                                {type === 'seeker' ? 'Ihre Interessen:' : 'Interessen der aktuellen Bewohner:'}
                            </label>
                            <div className="grid grid-cols-2 gap-2 sm:gap-3 p-3 border border-gray-300 rounded-lg bg-gray-50">
                                {allInterests.map(interest => (
                                    <label key={interest} className="inline-flex items-center text-gray-800 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            name="interests"
                                            value={interest}
                                            checked={formState.interests.includes(interest)}
                                            onChange={handleChange}
                                            className="form-checkbox h-4 w-4 sm:h-5 sm:w-5 text-[#3fd5c1] rounded focus:ring-2 focus:ring-[#3fd5c1]"
                                        />
                                        <span className="ml-2 text-xs sm:text-sm">{capitalizeFirstLetter(interest)}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Neu: Präferenzen für das Zusammenleben */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">
                                {type === 'seeker' ? 'Ihre Präferenzen für das Zusammenleben:' : 'Präferenzen für das Zusammenleben im Zimmer:'}
                            </label>
                            <div className="grid grid-cols-1 gap-2 sm:gap-3 p-3 border border-gray-300 rounded-lg bg-gray-50">
                                {allCommunalLivingPreferences.map(pref => (
                                    <label key={pref} className="inline-flex items-center text-gray-800 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            name={type === 'seeker' ? 'communalLivingPreferences' : 'roomCommunalLiving'}
                                            value={pref}
                                            checked={(formState[type === 'seeker' ? 'communalLivingPreferences' : 'roomCommunalLiving'] || []).includes(pref)}
                                            onChange={handleChange}
                                            className="form-checkbox h-4 w-4 sm:h-5 sm:w-5 text-[#3fd5c1] rounded focus:ring-2 focus:ring-[#3fd5c1]"
                                        />
                                        <span className="ml-2 text-xs sm:text-sm">{capitalizeFirstLetter(pref)}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* --- SCHRITT 3 --- */}
                {currentStep === 3 && (
                    <div className="space-y-4">
                        {/* Was gesucht wird (Suchender) / Beschreibung des Zimmers (Anbieter) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Was suchen Sie in einem Zimmer?:</label>
                                <textarea
                                    name="lookingFor"
                                    value={formState.lookingFor}
                                    onChange={handleChange}
                                    rows="3"
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                ></textarea>
                            </div>
                        )}
                        {type === 'provider' && (
                            <>
                                <div>
                                    <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Zimmerbeschreibung:</label>
                                    <textarea
                                        name="description"
                                        value={formState.description}
                                        onChange={handleChange}
                                        rows="3"
                                        className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                    ></textarea>
                                </div>
                                <div>
                                    <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Was suchen Sie in einem neuen Mitbewohner?:</label>
                                    <textarea
                                        name="lookingForInFlatmate"
                                        value={formState.lookingForInFlatmate}
                                        onChange={handleChange}
                                        rows="3"
                                        className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                ></textarea>
                                </div>
                            </>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Zimmertyp:</label>
                                <select
                                    name="roomType"
                                    value={formState.roomType}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                >
                                    <option value="Single Room">Einzelzimmer</option>
                                    <option value="Double Room">Doppelzimmer</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Durchschnittliches Alter der Bewohner:</label>
                                <input
                                    type="number"
                                    name="avgAge"
                                    value={formState.avgAge}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                />
                            </div>
                        )}

                        {/* Neu: Werte */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">
                                {type === 'seeker' ? 'Ihre Werte und Erwartungen an das WG-Leben:' : 'Werte und Erwartungen des Zimmers:'}
                            </label>
                            <div className="grid grid-cols-1 gap-2 sm:gap-3 p-3 border border-gray-300 rounded-lg bg-gray-50">
                                {allWGValues.map(val => (
                                    <label key={val} className="inline-flex items-center text-gray-800 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            name={type === 'seeker' ? 'values' : 'roomValues'}
                                            value={val}
                                            checked={(formState[type === 'seeker' ? 'values' : 'roomValues'] || []).includes(val)}
                                            onChange={handleChange}
                                            className="form-checkbox h-4 w-4 sm:h-5 sm:w-5 text-[#3fd5c1] rounded focus:ring-2 focus:ring-[#3fd5c1]"
                                        />
                                        <span className="ml-2 text-xs sm:text-sm">{capitalizeFirstLetter(val)}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex justify-between mt-6 sm:mt-8">
                    <button
                        type="button"
                        onClick={handleCancel}
                        className="flex items-center px-4 py-2 sm:px-6 sm:py-3 bg-gray-300 text-gray-800 font-bold rounded-xl shadow-md hover:bg-gray-400 transition duration-150 ease-in-out transform hover:-translate-y-0.5 text-sm sm:text-base"
                    >
                        <XCircle size={18} className="mr-1 sm:mr-2" /> Abbrechen
                    </button>
                    {currentStep > 1 && (
                        <button
                            type="button"
                            onClick={prevStep}
                            className="flex items-center px-4 py-2 sm:px-6 sm:py-3 bg-gray-300 text-gray-800 font-bold rounded-xl shadow-md hover:bg-gray-400 transition duration-150 ease-in-out transform hover:-translate-y-0.5 text-sm sm:text-base"
                        >
                            Zurück
                        </button>
                    )}
                    {currentStep < totalSteps ? (
                        <button
                            type="button"
                            onClick={nextStep}
                            className="flex items-center px-4 py-2 sm:px-6 sm:py-3 bg-[#3fd5c1] text-white font-bold rounded-xl shadow-lg hover:bg-[#32c0ae] transition duration-150 ease-in-out transform hover:-translate-y-0.5 text-sm sm:text-base"
                        >
                            Weiter
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleSubmit}
                            className={`flex items-center px-4 py-2 sm:px-6 sm:py-3 font-bold rounded-xl shadow-lg transition duration-150 ease-in-out transform hover:-translate-y-0.5 text-sm sm:text-base ${
                                type === 'seeker'
                                    ? 'bg-[#9adfaa] hover:bg-[#85c292] text-[#333333]'
                                    : 'bg-[#fecd82] hover:bg-[#e6b772] text-[#333333]'
                            }`}
                        >
                            <CheckCircle size={18} className="mr-1 sm:mr-2" /> Profil speichern
                        </button>
                    )}
                </div>
            </form>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#3fd5c1] to-[#e0f7f4]">
                <p className="text-gray-700 text-lg animate-pulse">App und Daten werden geladen...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-red-100 text-red-700 p-4 rounded-lg">
                <p>Fehler: {error}</p>
            </div>
        );
    }

    const showMySeekerDashboard = mySearcherProfiles.length > 0 && !adminMode;
    const showMyRoomDashboard = myRoomProfiles.length > 0 && !adminMode;

    return (
        // Angepasstes Padding für den Haupt-App-Container
        <div className="min-h-screen bg-[#3fd5c1] pt-8 sm:pt-12 p-4 font-inter flex flex-col items-center relative overflow-hidden">
            {/* Hintergrundkreise für visuelle Dynamik */}
            <div className="absolute top-[-50px] left-[-50px] w-48 h-48 bg-white opacity-10 rounded-full animate-blob-slow"></div>
            <div className="absolute bottom-[-50px] right-[-50px] w-64 h-64 bg-white opacity-10 rounded-full animate-blob-medium"></div>
            <div className="absolute top-1/3 right-1/4 w-32 h-32 bg-white opacity-10 rounded-full animate-blob-fast"></div>

            {/* Header: Logo und Benutzerinfo / Login / Logout */}
            <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 sm:mb-8 text-center drop-shadow-lg">Roomatch</h1>
            
            <div className="bg-[#c3efe8] text-[#0a665a] text-xs sm:text-sm px-4 py-2 sm:px-6 sm:py-3 rounded-full mb-6 sm:mb-8 shadow-md flex flex-col sm:flex-row items-center transform transition-all duration-300 hover:scale-[1.02] text-center">
                {userId ? (
                    <>
                        <span className="mb-1 sm:mb-0 sm:mr-2 flex items-center">
                            <User size={16} className="mr-1" /> Angemeldet als: <span className="font-semibold ml-1">{userName}</span>
                        </span>
                        {/* Benutzer-ID und Kopier-Button anzeigen */}
                        <div className="flex items-center ml-2 sm:ml-4 relative">
                            <span className="font-mono text-xs break-all ml-1 sm:ml-2">UID: {userId}</span>
                            <button
                                onClick={copyUidToClipboard}
                                className="ml-2 p-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                                title="Benutzer-ID kopieren"
                            >
                                <Copy size={14} />
                            </button>
                            {showUserIdCopied && (
                                <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-700 text-white text-xs px-2 py-1 rounded-md animate-fade-in-out">
                                    Kopiert!
                                </span>
                            )}
                        </div>

                        {userId === ADMIN_UID && (
                            <label className="mt-2 sm:mt-0 sm:ml-6 inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="form-checkbox h-4 w-4 sm:h-5 sm:w-5 text-[#3fd5c1] rounded-md transition-all duration-200 focus:ring-2 focus:ring-[#3fd5c1]"
                                    checked={adminMode}
                                    onChange={() => setAdminMode(!adminMode)}
                                />
                                <span className="ml-2 text-[#0a665a] font-bold select-none">Admin-Modus</span>
                            </label>
                        )}
                        <button
                            onClick={handleSignOut}
                            className="ml-4 sm:ml-6 px-3 py-1.5 sm:px-4 sm:py-2 bg-gray-200 text-gray-700 font-bold rounded-lg shadow-md hover:bg-gray-300 transition duration-150 ease-in-out flex items-center text-sm"
                        >
                            <LogOut size={16} className="mr-1.5" /> Abmelden
                        </button>
                    </>
                ) : (
                    <>
                        <span className="mb-1 sm:mb-0 sm:mr-2 flex items-center">
                            <User size={16} className="mr-1" /> Nicht angemeldet.
                        </span>
                        <button
                            onClick={handleGoogleSignIn}
                            className="ml-4 sm:ml-6 px-3 py-1.5 sm:px-4 sm:py-2 bg-white text-[#3fd5c1] font-bold rounded-lg shadow-md hover:bg-gray-100 transition duration-150 ease-in-out flex items-center text-sm"
                        >
                            <LogIn size={16} className="mr-1.5" /> Mit Google anmelden
                        </button>
                    </>
                )}
            </div>

            {/* Erfolgsmeldung als festes Overlay angezeigt */}
            {saveMessage && (
                <div className={`
                    fixed top-4 left-1/2 -translate-x-1/2 z-50
                    bg-green-100 text-green-700 px-4 py-2 sm:px-5 sm:py-3 rounded-lg shadow-xl text-sm sm:text-base
                    transition-opacity duration-500 ease-in-out
                    ${showSaveMessageElement ? 'opacity-100' : 'opacity-0 pointer-events-none'}
                `}>
                    {saveMessage}
                </div>
            )}

            {/* Hauptnavigationsbuttons (Startseite/Chats) */}
            {userId && !adminMode && ( // Navigation nur anzeigen, wenn angemeldet und nicht im Admin-Modus
                <div className="w-full max-w-6xl mx-auto flex justify-center space-x-4 mb-8">
                    <button
                        onClick={() => { setCurrentView('home'); setInitialChatTargetUid(null); setInitialChatTargetProfileId(null); setInitialChatTargetProfileName(null); setInitialChatTargetProfileType(null); }}
                        className={`px-6 py-3 rounded-xl text-lg font-semibold shadow-md transition-all duration-300 transform hover:scale-105 ${
                            currentView === 'home' ? 'bg-white text-[#3fd5c1]' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        <HomeIcon className="inline-block mr-2" size={20} /> Startseite
                    </button>
                    <button
                        onClick={() => { setCurrentView('chats'); setInitialChatTargetUid(null); setInitialChatTargetProfileId(null); setInitialChatTargetProfileName(null); setInitialChatTargetProfileType(null); }} // Beim Klicken auf 'Chats' targetUid zurücksetzen
                        className={`px-6 py-3 rounded-xl text-lg font-semibold shadow-md transition-all duration-300 transform hover:scale-105 ${
                            currentView === 'chats' ? 'bg-white text-[#3fd5c1]' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        <MessageSquareText className="inline-block mr-2" size={20} /> Chats
                    </button>
                </div>
            )}


            {/* Hauptinhalts-Wrapper - Oberer Rand entfernt, da globales Padding dies handhabt */}
            <div className="w-full max-w-6xl flex flex-col items-center">
                {/* Bedingtes Rendering basierend auf currentView */}
                {adminMode ? (
                    // ADMIN-MODUS AN: Alle Admin-Dashboards anzeigen
                    <div className="w-full max-w-6xl flex flex-col gap-8 sm:gap-12">
                        {/* Admin-Matches: Suchender findet Zimmer */}
                        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">Matches: Suchender findet Zimmer (Admin-Ansicht)</h2>
                            {matches.length === 0 ? (
                                <p className="text-center text-gray-600 text-base sm:text-lg py-4">Keine Übereinstimmungen gefunden.</p>
                            ) : (
                                <div className="space-y-6 sm:space-y-8">
                                    {matches.map((searcherMatch, index) => (
                                        <div key={index} className="bg-[#f0f8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                            <h3 className="text-xl sm:text-2xl font-bold text-[#333333] mb-3 sm:mb-4 flex items-center">
                                                <Search size={20} className="mr-2 sm:mr-3 text-[#5a9c68]" /> Name des Suchenden: <span className="font-extrabold ml-1 sm:ml-2">{searcherMatch.searcher.name}</span> <span className="text-sm font-normal text-gray-600 ml-1">(ID: {searcherMatch.searcher.id.substring(0, 8)}...)</span>
                                            </h3>
                                            <h4 className="text-lg sm:text-xl font-bold text-[#5a9c68] mt-6 sm:mt-8 mb-3 sm:mb-4 flex items-center">
                                                <Heart size={18} className="mr-1 sm:mr-2" /> Passende Zimmerangebote:
                                            </h4>
                                            <div className="space-y-2">
                                                {searcherMatch.matchingRooms.length === 0 ? (
                                                    <p className="text-gray-600 text-sm lg:text-base">Keine passenden Zimmer für dieses Profil.</p>
                                                ) : (
                                                    searcherMatch.matchingRooms.map(roomMatch => (
                                                        <div key={roomMatch.room.id} className="bg-white p-4 sm:p-5 rounded-lg shadow border border-[#9adfaa] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                            <div>
                                                                <p className="font-bold text-gray-800 text-base md:text-lg">Zimmername: {roomMatch.room.name}</p>
                                                                <div className="flex items-center mt-1 sm:mt-2">
                                                                    <div className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold inline-block ${getScoreColorClass(roomMatch.score)}`}>
                                                                        Score: {roomMatch.score.toFixed(0)}
                                                                    </div>
                                                                    <button
                                                                        onClick={() => setSelectedMatchDetails({ seeker: searcherMatch.searcher, room: roomMatch.room, matchDetails: roomMatch.fullMatchResult })}
                                                                        className="ml-2 sm:ml-3 p-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                                                                        title="Match-Details anzeigen"
                                                                    >
                                                                        <Info size={16} />
                                                                    </button>
                                                                    {userId && roomMatch.room.createdBy !== userId && ( // Chat mit sich selbst nicht anzeigen
                                                                        <button
                                                                            onClick={() => {
                                                                                console.log("App: Clicked chat from Seeker Matches. Target UID:", roomMatch.room.createdBy, "Room Name:", roomMatch.room.name);
                                                                                handleStartChat(roomMatch.room.createdBy, roomMatch.room.id, roomMatch.room.name, 'room');
                                                                            }}
                                                                            className="ml-2 sm:ml-3 p-1 rounded-full bg-[#9adfaa] text-white hover:bg-[#85c292] transition"
                                                                            title="Chat mit Zimmerersteller starten"
                                                                        >
                                                                            <MessageSquareText size={16} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <p className="text-sm md:text-base text-gray-600 mt-1 mb-0.5 leading-tight"><span className="font-medium">Gewünschtes Alter:</span> {roomMatch.room.minAge}-{roomMatch.room.maxAge}, <span className="font-medium">Geschlechtspräferenz:</span> {capitalizeFirstLetter(roomMatch.room.genderPreference)}</p>
                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Miete:</span> {roomMatch.room.rent}€, <span className="font-medium">Zimmertyp:</span> {capitalizeFirstLetter(roomMatch.room.roomType)}</p>
                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Haustiere erlaubt:</span> {capitalizeFirstLetter(roomMatch.room.petsAllowed === 'yes' ? 'Ja' : 'Nein')}</p>
                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Interessen der Bewohner:</span> {Array.isArray(roomMatch.room.interests) ? roomMatch.room.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.interests || 'N/A')}</p>
                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Persönlichkeit:</span> {Array.isArray(roomMatch.room.personalityTraits) ? roomMatch.room.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.personalityTraits || 'N/A')}</p>
                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Zusammenleben:</span> {Array.isArray(roomMatch.room.roomCommunalLiving) ? roomMatch.room.roomCommunalLiving.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomCommunalLiving || 'N/A')}</p>
                                                                <p className="text-sm md:text-base text-gray-600 mb-1 leading-tight"><span className="font-medium">Zimmerwerte:</span> {Array.isArray(roomMatch.room.roomValues) ? roomMatch.room.roomValues.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomValues || 'N/A')}</p>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Admin-Matches: Zimmer findet Suchenden */}
                        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">Matches: Zimmer findet Suchenden (Admin-Ansicht)</h2>
                            {reverseMatches.length === 0 ? (
                                <p className="text-center text-gray-600 text-base sm:text-lg py-4">Keine Übereinstimmungen gefunden.</p>
                            ) : (
                                <div className="space-y-6 sm:space-y-8">
                                    {reverseMatches.map((roomMatch, index) => (
                                        <div key={index} className="bg-[#fff8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#fecd82] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                            <h3 className="text-xl sm:text-2xl font-bold text-[#333333] mb-3 sm:mb-4 flex items-center">
                                                <HomeIcon size={20} className="mr-2 sm:mr-3 text-[#cc8a2f]" /> Zimmername: <span className="font-extrabold ml-1 sm:ml-2">{roomMatch.room.name}</span> <span className="text-sm font-normal text-gray-600 ml-1">(ID: {roomMatch.room.id.substring(0, 8)}...)</span>
                                            </h3>
                                            <h4 className="text-lg sm:text-xl font-bold text-[#cc8a2f] mt-6 sm:mt-8 mb-3 sm:mb-4 flex items-center">
                                                <Users size={18} className="mr-1 sm:mr-2" /> Passende Suchende:
                                            </h4>
                                            <div className="space-y-2">
                                                {roomMatch.matchingSeekers.length === 0 ? (
                                                    <p className="text-gray-600 text-sm lg:text-base">Keine passenden Suchenden für dieses Zimmerprofil.</p>
                                                ) : (
                                                    roomMatch.matchingSeekers.map(seekerMatch => (
                                                        <div key={seekerMatch.searcher.id} className="bg-white p-4 sm:p-5 rounded-lg shadow border border-[#fecd82] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                            <div>
                                                                <p className="font-bold text-gray-800 text-base md:text-lg">Suchender: {seekerMatch.searcher.name}</p>
                                                                <div className="flex items-center mt-1 sm:mt-2">
                                                                    <div className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold inline-block ${getScoreColorClass(seekerMatch.score)}`}>
                                                                        Score: {seekerMatch.score.toFixed(0)}
                                                                    </div>
                                                                    <button
                                                                        onClick={() => setSelectedMatchDetails({ seeker: seekerMatch.searcher, room: roomMatch.room, matchDetails: seekerMatch.fullMatchResult })}
                                                                        className="ml-2 sm:ml-3 p-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                                                                        title="Match-Details anzeigen"
                                                                    >
                                                                        <Info size={16} />
                                                                    </button>
                                                                    {userId && seekerMatch.searcher.createdBy !== userId && ( // Chat mit sich selbst nicht anzeigen
                                                                        <button
                                                                            onClick={() => {
                                                                                console.log("App: Clicked chat from Room Matches. Target UID:", seekerMatch.searcher.createdBy, "Seeker Name:", seekerMatch.searcher.name);
                                                                                handleStartChat(seekerMatch.searcher.createdBy, seekerMatch.searcher.id, seekerMatch.searcher.name, 'seeker');
                                                                            }}
                                                                            className="ml-2 sm:ml-3 p-1 rounded-full bg-[#fecd82] text-white hover:bg-[#e6b772] transition"
                                                                            title="Chat mit Suchendem starten"
                                                                        >
                                                                            <MessageSquareText size={16} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <p className="text-sm md:text-base text-gray-600 mt-1 mb-0.5 leading-tight"><span className="font-medium">Alter:</span> {seekerMatch.searcher.age}, <span className="font-medium">Geschlecht:</span> {capitalizeFirstLetter(seekerMatch.searcher.gender)}</p>
                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Interessen:</span> {Array.isArray(seekerMatch.searcher.interests) ? seekerMatch.searcher.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.interests || 'N/A')}</p>
                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Persönlichkeit:</span> {Array.isArray(seekerMatch.searcher.personalityTraits) ? seekerMatch.searcher.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.personalityTraits || 'N/A')}</p>
                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Zimmerpräferenzen:</span> {Array.isArray(seekerMatch.searcher.communalLivingPreferences) ? seekerMatch.searcher.communalLivingPreferences.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.communalLivingPreferences || 'N/A')}</p>
                                                                <p className="text-sm md:text-base text-gray-600 mb-1 leading-tight"><span className="font-medium">Werte:</span> {Array.isArray(seekerMatch.searcher.values) ? seekerMatch.searcher.values.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.values || 'N/A')}</p>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        {/* Alle Suchprofile (Admin-Ansicht) */}
                        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">Alle Suchprofile (Admin-Ansicht)</h2>
                            {allSearcherProfilesGlobal.length === 0 ? (
                                <p className="text-center text-gray-600 text-base sm:text-lg py-4">Noch keine Suchprofile verfügbar.</p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {allSearcherProfilesGlobal.map(profile => (
                                        <div key={profile.id} className="bg-[#f0f8f0] p-5 sm:p-6 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                            <p className="font-bold text-[#333333] text-base md:text-lg mb-2">Name: {profile.name}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Alter:</span> {profile.age}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Geschlecht:</span> {capitalizeFirstLetter(profile.gender)}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Interessen:</span> {Array.isArray(profile.interests) ? profile.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.interests || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Persönlichkeit:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.personalityTraits || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Zusammenleben:</span> {Array.isArray(profile.communalLivingPreferences) ? profile.communalLivingPreferences.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.communalLivingPreferences || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-1 leading-tight"><span className="font-medium">Werte:</span> {Array.isArray(profile.values) ? profile.values.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.values || 'N/A')}</p>
                                            <p className="text-xs text-gray-500 mt-3 sm:mt-4">Erstellt von: {profile.createdBy}</p>
                                            <p className="text-xs text-gray-500">Am: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                                            <button
                                                onClick={() => handleDeleteProfile('searcherProfiles', profile.id, profile.name, profile.createdBy)}
                                                className="mt-4 sm:mt-6 px-4 py-1.5 sm:px-5 sm:py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out self-end flex items-center transform hover:-translate-y-0.5 text-sm"
                                            >
                                                <Trash2 size={14} className="mr-1.5" /> Löschen
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Alle Zimmerprofile (Admin-Ansicht) */}
                        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-8 sm:mb-12">
                            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">Alle Zimmerangebote (Admin-Ansicht)</h2>
                            {allRoomProfilesGlobal.length === 0 ? (
                                <p className="text-center text-gray-600 text-base sm:text-lg py-4">Noch keine Zimmerangebote verfügbar.</p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {allRoomProfilesGlobal.map(profile => (
                                        <div key={profile.id} className="bg-[#fff8f0] p-5 sm:p-6 rounded-xl shadow-lg border border-[#fecd82] flex flex-col transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                            <p className="font-bold text-[#333333] text-base md:text-lg mb-2">Zimmername: {profile.name}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Miete:</span> {profile.rent}€</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Zimmertyp:</span> {capitalizeFirstLetter(profile.roomType)}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Haustiere erlaubt:</span> {capitalizeFirstLetter(profile.petsAllowed === 'yes' ? 'Ja' : 'Nein')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Durchschnittliches Alter der Bewohner:</span> {profile.avgAge}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Interessen der Bewohner:</span> {Array.isArray(profile.interests) ? profile.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.interests || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Persönlichkeit:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.personalityTraits || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-medium">Zusammenleben:</span> {Array.isArray(profile.roomCommunalLiving) ? profile.roomCommunalLiving.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.roomCommunalLiving || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-1 leading-tight"><span className="font-medium">Zimmerwerte:</span> {Array.isArray(profile.roomValues) ? profile.roomValues.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.roomValues || 'N/A')}</p>
                                            <p className="text-xs text-gray-500 mt-3 sm:mt-4">Erstellt von: {profile.createdBy}</p>
                                            <p className="text-xs text-gray-500">Am: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                                            <button
                                                onClick={() => handleDeleteProfile(profile.isLegacy ? 'wgProfiles' : 'roomProfiles', profile.id, profile.name, profile.createdBy)}
                                                className="mt-4 sm:mt-6 px-4 py-1.5 sm:px-5 sm:py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out self-end flex items-center transform hover:-translate-y-0.5 text-sm"
                                            >
                                                <Trash2 size={14} className="mr-1.5" /> Löschen
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    // NORMALER BENUTZERMODUS
                    <div className="w-full max-w-6xl flex flex-col gap-8 sm:gap-12">
                        {currentView === 'home' ? (
                            <>
                                {/* Formularauswahl-Buttons / Login-Aufforderung */}
                                {userId ? (
                                    <div className="w-full max-w-xl mx-auto flex flex-col sm:flex-row justify-center space-y-4 sm:space-y-0 sm:space-x-6 mb-8 sm:mb-12 px-4">
                                        <button
                                            onClick={() => setShowSeekerForm(true)}
                                            className={`flex items-center justify-center px-6 py-3 sm:px-8 sm:py-4 rounded-xl text-lg sm:text-xl font-semibold shadow-xl transition-all duration-300 transform hover:scale-105 hover:shadow-2xl ${
                                                showSeekerForm
                                                    ? 'bg-[#9adfaa] text-[#333333]'
                                                    : 'bg-white text-[#9adfaa] hover:bg-gray-50'
                                            }`}
                                        >
                                            <Search size={20} className="mr-2" /> Suchprofil
                                        </button>
                                        <button
                                            onClick={() => setShowSeekerForm(false)}
                                            className={`flex items-center justify-center px-6 py-3 sm:px-8 sm:py-4 rounded-xl text-lg sm:text-xl font-semibold shadow-xl transition-all duration-300 transform hover:scale-105 hover:shadow-2xl ${
                                                !showSeekerForm
                                                    ? 'bg-[#fecd82] text-[#333333]'
                                                    : 'bg-white text-[#fecd82] hover:bg-gray-50'
                                            }`}
                                        >
                                            <HomeIcon size={20} className="mr-2" /> Zimmerangebot
                                        </button>
                                    </div>
                                ) : (
                                    <div className="w-full max-w-xl bg-white p-6 sm:p-8 rounded-2xl shadow-xl text-center text-gray-600 mb-8 sm:mb-12 mx-auto">
                                        <p className="text-base sm:text-lg">Bitte melden Sie sich an, um Profile zu erstellen und Matches zu sehen.</p>
                                        <button
                                            onClick={handleGoogleSignIn}
                                            className="mt-4 sm:mt-6 px-5 py-2 sm:px-6 sm:py-3 bg-[#3fd5c1] text-white font-bold rounded-xl shadow-lg hover:bg-[#32c0ae] transition duration-150 ease-in-out transform hover:-translate-y-0.5 text-base"
                                        >
                                            <span className="flex items-center"><LogIn size={18} className="mr-2" /> Mit Google anmelden</span>
                                        </button>
                                    </div>
                                )}

                                {/* Aktuelles Formular */}
                                {userId && (
                                    <div className="w-full max-w-xl mb-8 sm:mb-12 mx-auto">
                                        <ProfileForm onSubmit={showSeekerForm ? addSearcherProfile : addRoomProfile} type={showSeekerForm ? "seeker" : "provider"} key={showSeekerForm ? "seekerForm" : "providerForm"} />
                                    </div>
                                )}

                                {/* Benutzer-Dashboards (wenn Profile existieren UND Benutzer angemeldet ist) */}
                                {(showMySeekerDashboard || showMyRoomDashboard) && userId ? (
                                    <div className="flex flex-col gap-8 sm:gap-12 w-full">
                                        {mySearcherProfiles.length > 0 && (
                                            <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-8 sm:mb-12">
                                                <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">Meine Suchprofile & Matches</h2>
                                                {mySearcherProfiles.map(profile => {
                                                    const profileMatches = matches.find(m => m.searcher.id === profile.id);
                                                    return (
                                                        <div key={profile.id} id={`profile-${profile.id}`} className="bg-[#f0f8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl mb-6 sm:mb-8">
                                                            {/* Eigene Suchprofildetails */}
                                                            <h3 className="font-bold text-[#333333] text-base md:text-lg mb-3 sm:mb-4 flex items-center">
                                                                <Search size={20} className="mr-2 sm:mr-3 text-[#5a9c68]" /> Ihr Profil: <span className="font-extrabold ml-1 sm:ml-2">{profile.name}</span>
                                                            </h3>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Alter:</span> {profile.age}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Geschlecht:</span> {capitalizeFirstLetter(profile.gender)}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Max. Miete:</span> {profile.maxRent}€</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Haustiere:</span> {capitalizeFirstLetter(profile.pets === 'yes' ? 'Ja' : 'Nein')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Interessen:</span> {Array.isArray(profile.interests) ? profile.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.interests || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Persönlichkeit:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.personalityTraits || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Zusammenleben:</span> {Array.isArray(profile.communalLivingPreferences) ? profile.communalLivingPreferences.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.communalLivingPreferences || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-1 leading-tight"><span className="font-medium">Werte:</span> {Array.isArray(profile.values) ? profile.values.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.values || 'N/A')}</p>
                                                            <button
                                                                onClick={() => handleDeleteProfile('searcherProfiles', profile.id, profile.name, profile.createdBy)}
                                                                className="mt-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out flex items-center text-sm"
                                                            >
                                                                <Trash2 size={14} className="mr-1.5" /> Profil löschen
                                                            </button>

                                                            {/* Matches für dieses spezifische Suchprofil */}
                                                            <h4 className="text-lg sm:text-xl font-bold text-[#5a9c68] mt-6 sm:mt-8 mb-3 sm:mb-4 flex items-center">
                                                                <Heart size={18} className="mr-1 sm:mr-2" /> Passende Zimmerangebote für {profile.name}:
                                                            </h4>
                                                            <div className="space-y-2">
                                                                {profileMatches && profileMatches.matchingRooms.length > 0 ? (
                                                                    profileMatches.matchingRooms.map(roomMatch => (
                                                                        <div key={roomMatch.room.id} className="bg-white p-4 sm:p-5 rounded-lg shadow border border-[#9adfaa] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                                            <div>
                                                                                <p className="font-bold text-gray-800 text-base md:text-lg">Zimmername: {roomMatch.room.name}</p>
                                                                                <div className="flex items-center mt-1 sm:mt-2">
                                                                                    <div className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold inline-block ${getScoreColorClass(roomMatch.score)}`}>
                                                                                        Score: {roomMatch.score.toFixed(0)}
                                                                                    </div>
                                                                                    <button
                                                                                        onClick={() => setSelectedMatchDetails({ seeker: profile, room: roomMatch.room, matchDetails: roomMatch.fullMatchResult })}
                                                                                        className="ml-2 sm:ml-3 p-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                                                                                        title="Match-Details anzeigen"
                                                                                    >
                                                                                        <Info size={16} />
                                                                                    </button>
                                                                                    {userId && roomMatch.room.createdBy !== userId && ( // Chat mit sich selbst nicht anzeigen
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                console.log("App: Clicked chat from Seeker Matches. Target UID:", roomMatch.room.createdBy, "Room Name:", roomMatch.room.name);
                                                                                                handleStartChat(roomMatch.room.createdBy, roomMatch.room.id, roomMatch.room.name, 'room');
                                                                                            }}
                                                                                            className="ml-2 sm:ml-3 p-1 rounded-full bg-[#9adfaa] text-white hover:bg-[#85c292] transition"
                                                                                            title="Chat mit Zimmerersteller starten"
                                                                                        >
                                                                                            <MessageSquareText size={16} />
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                                <p className="text-sm md:text-base text-gray-600 mt-1 mb-0.5 leading-tight"><span className="font-medium">Gewünschtes Alter:</span> {roomMatch.room.minAge}-{roomMatch.room.maxAge}, <span className="font-medium">Geschlechtspräferenz:</span> {capitalizeFirstLetter(roomMatch.room.genderPreference)}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Miete:</span> {roomMatch.room.rent}€, <span className="font-medium">Zimmertyp:</span> {capitalizeFirstLetter(roomMatch.room.roomType)}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Haustiere erlaubt:</span> {capitalizeFirstLetter(roomMatch.room.petsAllowed === 'yes' ? 'Ja' : 'Nein')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Interessen der Bewohner:</span> {Array.isArray(roomMatch.room.interests) ? roomMatch.room.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.interests || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Persönlichkeit:</span> {Array.isArray(roomMatch.room.personalityTraits) ? roomMatch.room.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.personalityTraits || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Zusammenleben:</span> {Array.isArray(roomMatch.room.roomCommunalLiving) ? roomMatch.room.roomCommunalLiving.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomCommunalLiving || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-1 leading-tight"><span className="font-medium">Zimmerwerte:</span> {Array.isArray(roomMatch.room.roomValues) ? roomMatch.room.roomValues.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomValues || 'N/A')}</p>
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <p className="text-gray-600 text-sm lg:text-base">Keine passenden Zimmer für dieses Profil.</p>
                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {myRoomProfiles.length > 0 && (
                                            <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-8 sm:mb-12">
                                                <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">Meine Zimmerangebote & Matches</h2>
                                                {myRoomProfiles.map(profile => {
                                                    const profileMatches = reverseMatches.find(m => m.room.id === profile.id);
                                                    return (
                                                        <div key={profile.id} id={`profile-${profile.id}`} className="bg-[#fff8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#fecd82] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl mb-6 sm:mb-8">
                                                            {/* Eigene Zimmerprofildetails */}
                                                            <h3 className="font-bold text-[#333333] text-base md:text-lg mb-3 sm:mb-4 flex items-center">
                                                                <HomeIcon size={20} className="mr-2 sm:mr-3 text-[#cc8a2f]" /> Ihr Zimmerprofil: <span className="font-extrabold ml-1 sm:ml-2">{profile.name}</span>
                                                            </h3>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Miete:</span> {profile.rent}€</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Zimmertyp:</span> {capitalizeFirstLetter(profile.roomType)}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Haustiere erlaubt:</span> {capitalizeFirstLetter(profile.petsAllowed === 'yes' ? 'Ja' : 'Nein')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Durchschnittliches Alter der Bewohner:</span> {profile.avgAge}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Interessen der Bewohner:</span> {Array.isArray(profile.interests) ? profile.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.interests || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Persönlichkeit:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.personalityTraits || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-medium">Zusammenleben:</span> {Array.isArray(profile.roomCommunalLiving) ? profile.roomCommunalLiving.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.roomCommunalLiving || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-1 leading-tight"><span className="font-medium">Zimmerwerte:</span> {Array.isArray(profile.roomValues) ? profile.roomValues.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.roomValues || 'N/A')}</p>
                                                            <button
                                                                onClick={() => handleDeleteProfile(profile.isLegacy ? 'wgProfiles' : 'roomProfiles', profile.id, profile.name, profile.createdBy)}
                                                                className="mt-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out flex items-center text-sm"
                                                            >
                                                                <Trash2 size={14} className="mr-1.5" /> Profil löschen
                                                            </button>

                                                            {/* Matches für dieses spezifische Zimmerprofil */}
                                                            <h4 className="text-lg sm:text-xl font-bold text-[#cc8a2f] mt-6 sm:mt-8 mb-3 sm:mb-4 flex items-center">
                                                                <Users size={18} className="mr-1 sm:mr-2" /> Passende Suchende für {profile.name}:
                                                            </h4>
                                                            <div className="space-y-2">
                                                                {profileMatches && profileMatches.matchingSeekers.length > 0 ? (
                                                                    profileMatches.matchingSeekers.map(seekerMatch => (
                                                                        <div key={seekerMatch.searcher.id} className="bg-white p-4 sm:p-5 rounded-lg shadow border border-[#fecd82] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                                            <div>
                                                                                <p className="font-bold text-gray-800 text-base md:text-lg">Suchender: {seekerMatch.searcher.name}</p>
                                                                                <div className="flex items-center mt-1 sm:mt-2">
                                                                                    <div className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold inline-block ${getScoreColorClass(seekerMatch.score)}`}>
                                                                                        Score: {seekerMatch.score.toFixed(0)}
                                                                                    </div>
                                                                                    <button
                                                                                        onClick={() => setSelectedMatchDetails({ seeker: seekerMatch.searcher, room: profile, matchDetails: seekerMatch.fullMatchResult })}
                                                                                        className="ml-2 sm:ml-3 p-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                                                                                        title="Match-Details anzeigen"
                                                                                    >
                                                                                        <Info size={16} />
                                                                                    </button>
                                                                                    {userId && seekerMatch.searcher.createdBy !== userId && ( // Chat mit sich selbst nicht anzeigen
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                console.log("App: Clicked chat from Room Matches. Target UID:", seekerMatch.searcher.createdBy, "Seeker Name:", seekerMatch.searcher.name);
                                                                                                handleStartChat(seekerMatch.searcher.createdBy, seekerMatch.searcher.id, seekerMatch.searcher.name, 'seeker');
                                                                                            }}
                                                                                            className="ml-2 sm:ml-3 p-1 rounded-full bg-[#fecd82] text-white hover:bg-[#e6b772] transition"
                                                                                            title="Chat mit Suchendem starten"
                                                                                        >
                                                                                            <MessageSquareText size={16} />
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                                <p className="text-sm md:text-base text-gray-600 mt-1 mb-0.5 leading-tight"><span className="font-medium">Alter:</span> {seekerMatch.searcher.age}, <span className="font-medium">Geschlecht:</span> {capitalizeFirstLetter(seekerMatch.searcher.gender)}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Interessen:</span> {Array.isArray(seekerMatch.searcher.interests) ? seekerMatch.searcher.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.interests || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Persönlichkeit:</span> {Array.isArray(seekerMatch.searcher.personalityTraits) ? seekerMatch.searcher.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.personalityTraits || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Zimmerpräferenzen:</span> {Array.isArray(seekerMatch.searcher.communalLivingPreferences) ? seekerMatch.searcher.communalLivingPreferences.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.communalLivingPreferences || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-1 leading-tight"><span className="font-medium">Werte:</span> {Array.isArray(seekerMatch.searcher.values) ? seekerMatch.searcher.values.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.values || 'N/A')}</p>
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <p className="text-center text-gray-600 text-sm lg:text-base">Keine passenden Suchenden für dieses Zimmerprofil.</p>
                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    // Wenn keine Profile für den Benutzer existieren, eine Nachricht anzeigen
                                    userId && (
                                        <div className="w-full max-w-xl bg-white p-6 sm:p-8 rounded-2xl shadow-xl text-center text-gray-600 mb-8 sm:mb-12 mx-auto">
                                            <p className="text-base sm:text-lg">Erstellen Sie ein Profil, um Ihre Matches zu sehen!</p>
                                        </div>
                                    )
                                )}
                            </>
                        ) : (
                            // ChatPage rendern, wenn currentView 'chats' ist
                            <ChatPage
                                db={db}
                                currentUserUid={userId}
                                currentUserName={userName}
                                allSearcherProfilesGlobal={allSearcherProfilesGlobal}
                                allRoomProfilesGlobal={allRoomProfilesGlobal}
                                initialChatTargetUid={initialChatTargetUid}
                                setInitialChatTargetUid={setInitialChatTargetUid} // Den Setter weitergeben
                                initialChatTargetProfileId={initialChatTargetProfileId} // Neu
                                setInitialChatTargetProfileId={setInitialChatTargetProfileId} // Neu
                                initialChatTargetProfileName={initialChatTargetProfileName} // Neu
                                setInitialChatTargetProfileName={setInitialChatTargetProfileName} // Neu
                                initialChatTargetProfileType={initialChatTargetProfileType} // Neu
                                setInitialChatTargetProfileType={setInitialChatTargetProfileType} // Neu
                            />
                        )}
                    </div>
                )}

                <MatchDetailsModal
                    isOpen={!!selectedMatchDetails}
                    onClose={() => setSelectedMatchDetails(null)}
                    seeker={selectedMatchDetails?.seeker}
                    room={selectedMatchDetails?.room}
                    matchDetails={selectedMatchDetails?.matchDetails}
                />
            </div>
        </div>
    );
}

export default App;