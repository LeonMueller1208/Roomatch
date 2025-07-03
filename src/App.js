import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc, serverTimestamp, orderBy, limit, setDoc, getDocs } from 'firebase/firestore';
import { Search, Users, Heart, Trash2, User, Home as HomeIcon, CheckCircle, XCircle, Info, LogIn, LogOut, Copy, MessageSquareText } from 'lucide-react';

// Tailwind CSS is loaded. This script tag is usually placed in the <head> section of the public/index.html file.
// For the Canvas environment, it is assumed to be available or injected.
// <script src="https://cdn.tailwindcss.com"></script>

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyACGoSxD0_UZhWg06gzZjaifBn3sI06YGg", // <--- API KEY UPDATED HERE!
    authDomain: "mvp-roomatch.firebaseapp.com",
    projectId: "mvp-roomatch",
    storageBucket: "mvp-roomatch.firebaseapp.com",
    messagingSenderId: "190918526277",
    appId: "1:190918526277:web:268e07e2f1f326b8e86a2c",
    measurementId: "G-5JPWLD0ZC"
};

// Predefined lists for personality traits and interests
const allPersonalityTraits = ['tidy', 'calm', 'social', 'creative', 'sporty', 'night owl', 'early bird', 'tolerant', 'animal lover', 'flexible', 'structured'];
const allInterests = ['Cooking', 'Movies', 'Music', 'Games', 'Nature', 'Sports', 'Reading', 'Travel', 'Partying', 'Gaming', 'Plants', 'Culture', 'Art'];
const allCommunalLivingPreferences = ['very tidy', 'rather relaxed', 'prefers weekly cleaning schedules', 'spontaneous tidying', 'often cook together', 'sometimes cook together', 'rarely cook together'];
const allWGValues = ['sustainability important', 'open communication preferred', 'respect for privacy', 'shared activities important', 'prefers quiet home', 'prefers lively home', 'politically engaged', 'culturally interested'];

// **IMPORTANT:** REPLACE THIS VALUE EXACTLY WITH YOUR ACTUAL ADMIN UID, WHICH WILL BE DISPLAYED IN THE APP AFTER SUCCESSFUL GOOGLE LOGIN!
const ADMIN_UID = "hFt4BLSEg0UYAAUSfdf404mfw5v2"; // Placeholder: Please enter your Admin ID here!

// Helper function for safe integer parsing
const safeParseInt = (value) => parseInt(value) || 0;

// Helper function to capitalize the first letter for display
const capitalizeFirstLetter = (string) => {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
};

// Helper function to get a consistently sorted array of participant UIDs
// This is crucial for querying 1:1 chats in Firestore
const getSortedParticipantsUids = (uid1, uid2) => {
    const uids = [uid1, uid2];
    uids.sort(); // Sorts alphabetically to ensure a consistent chat document ID
    return uids;
};

// Function to calculate the match score between a seeker and a room profile
// Now returns an object with total score and detailed breakdown
const calculateMatchScore = (seeker, room) => {
    let totalScore = 0;
    // Initialize details with all possible categories and default values
    const details = {
        ageMatch: { score: 0, description: `Age Match (N/A)` },
        genderMatch: { score: 0, description: `Gender Preference (N/A)` },
        personalityTraits: { score: 0, description: `Personality Overlap (None)` },
        interests: { score: 0, description: `Interest Overlap (None)` },
        rentMatch: { score: 0, description: `Rent Match (N/A)` },
        petsMatch: { score: 0, description: `Pet Compatibility (N/A)` },
        freeTextMatch: { score: 0, description: `Free Text Keywords (None)` },
        avgAgeDifference: { score: 0, description: `Average Age Difference (N/A)` },
        communalLiving: { score: 0, description: `Communal Living Preferences (None)` },
        values: { score: 0, description: `Shared Values (None)` },
    };

    const getArrayValue = (profile, field) => {
        const value = profile[field];
        return Array.isArray(value) ? value : (value ? String(value).split(',').map(s => s.trim()) : []);
    };

    // Define fixed weights for matching criteria
    const MATCH_WEIGHTS = {
        ageMatch: 2.0,       // Age is twice as important
        genderMatch: 1.0,    // Gender is usually important
        personalityTraits: 1.5, // Personality traits are 1.5 times as important
        interests: 0.5,      // Interests are half as important
        rentMatch: 2.5,      // Rent is 2.5 times as important
        petsMatch: 1.2,      // Pets are slightly more important
        freeTextMatch: 0.2,  // Free text has low importance
        avgAgeDifference: 1.0, // Age difference (negative contribution)
        communalLiving: 1.8, // Communal living preferences are important
        values: 2.0          // Values are twice as important
    };

    // 1. Age Match (Seeker's age vs. Room's age range)
    const seekerAge = safeParseInt(seeker.age);
    const roomMinAge = safeParseInt(room?.minAge);
    const roomMaxAge = safeParseInt(room?.maxAge);
    let ageScore = 0;
    let ageDescription = `Age Match (Seeker: ${seeker.age || 'N/A'}, Room: ${room?.minAge || 'N/A'}-${room?.maxAge || 'N/A'})`;

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

    // 2. Gender Preference - If specific preference doesn't match, return a disqualifying score
    let genderScore = 0;
    let genderDescription = `Gender Preference (Seeker: ${capitalizeFirstLetter(seeker.gender || 'N/A')}, Room: ${capitalizeFirstLetter(room?.genderPreference || 'N/A')})`;
    if (seeker.gender && room?.genderPreference) {
        if (room.genderPreference !== 'any' && seeker.gender !== room.genderPreference) {
            return { totalScore: -999999, details: { ...details, genderMatch: { score: -999999, description: "Gender Mismatch (Disqualified)" } } };
        } else if (room.genderPreference === 'any' || seeker.gender === room.genderPreference) {
            genderScore = 10 * MATCH_WEIGHTS.genderMatch;
        }
    }
    details.genderMatch = { score: genderScore, description: genderDescription };
    totalScore += genderScore;

    // 3. Personality Traits (Overlap)
    const seekerTraits = getArrayValue(seeker, 'personalityTraits');
    const roomTraits = getArrayValue(room, 'personalityTraits');
    const commonTraits = seekerTraits.filter(trait => roomTraits.includes(trait));
    let personalityScore = commonTraits.length * 5 * MATCH_WEIGHTS.personalityTraits;
    details.personalityTraits = { score: personalityScore, description: `Personality Overlap (${commonTraits.map(capitalizeFirstLetter).join(', ') || 'None'})` };
    totalScore += personalityScore;

    // 4. Interests (Overlap)
    const seekerInterests = getArrayValue(seeker, 'interests');
    const roomInterests = getArrayValue(room, 'interests');
    const commonInterests = seekerInterests.filter(interest => roomInterests.includes(interest));
    let interestsScore = commonInterests.length * 3 * MATCH_WEIGHTS.interests;
    totalScore += interestsScore;
    details.interests = { score: interestsScore, description: `Interest Overlap (${commonInterests.map(capitalizeFirstLetter).join(', ') || 'None'})` };

    // 5. Rent (Seeker's max rent >= Room's rent)
    const seekerMaxRent = safeParseInt(seeker.maxRent);
    const roomRent = safeParseInt(room?.rent);
    let rentScore = 0;
    let rentDescription = `Rent Match (Max: ${seekerMaxRent || 'N/A'}€, Room: ${roomRent || 'N/A'}€)`;

    if (seekerMaxRent > 0 && roomRent > 0) {
        if (seekerMaxRent >= roomRent) {
            rentScore = 15 * MATCH_WEIGHTS.rentMatch;
        } else {
            rentScore = -(roomRent - seekerMaxRent) * MATCH_WEIGHTS.rentMatch * 0.2;
        }
    }
    details.rentMatch = { score: rentScore, description: rentDescription };
    totalScore += rentScore;

    // 6. Pets (Compatibility)
    let petsScore = 0;
    let petsDescription = `Pet Compatibility (Seeker: ${capitalizeFirstLetter(seeker.pets || 'N/A')}, Room: ${capitalizeFirstLetter(room?.petsAllowed || 'N/A')})`;
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

    // 7. Free text 'lookingFor' (Seeker) vs. 'description'/'lookingForInFlatmate' (Room)
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
    details.freeTextMatch = { score: freeTextScore, description: `Free Text Keywords (${matchedKeywords.map(capitalizeFirstLetter).join(', ') || 'None'})` };
    
    // 8. Average age of room residents compared to seeker's age
    const seekerAgeAvg = safeParseInt(seeker.age);
    const roomAvgAge = safeParseInt(room?.avgAge);
    let avgAgeDiffScore = 0;
    let avgAgeDescription = `Average Age Difference (Seeker: ${seeker.age || 'N/A'}, Room Average: ${room?.avgAge || 'N/A'})`;
    if (seekerAgeAvg > 0 && roomAvgAge > 0) {
        avgAgeDiffScore = -Math.abs(seekerAgeAvg - roomAvgAge) * MATCH_WEIGHTS.avgAgeDifference;
    }
    details.avgAgeDifference = { score: avgAgeDiffScore, description: avgAgeDescription };
    totalScore += avgAgeDiffScore;

    // 9. New: Communal Living Preferences
    const seekerCommunalPrefs = getArrayValue(seeker, 'communalLivingPreferences');
    const roomCommunalPrefs = getArrayValue(room, 'roomCommunalLiving');
    const commonCommunalPrefs = seekerCommunalPrefs.filter(pref => roomCommunalPrefs.includes(pref));
    let communalLivingScore = commonCommunalPrefs.length * 7 * MATCH_WEIGHTS.communalLiving;
    totalScore += communalLivingScore;
    details.communalLiving = { score: communalLivingScore, description: `Communal Living Preferences (${commonCommunalPrefs.map(capitalizeFirstLetter).join(', ') || 'None'})` };

    // 10. New: Values
    const seekerValues = getArrayValue(seeker, 'values');
    const roomValues = getArrayValue(room, 'values');
    const commonValues = seekerValues.filter(val => roomValues.includes(val));
    let valuesScore = commonValues.length * 10 * MATCH_WEIGHTS.values;
    totalScore += valuesScore;
    details.values = { score: valuesScore, description: `Shared Values (${commonValues.map(capitalizeFirstLetter).join(', ') || 'None'})` };

    return { totalScore, details };
};

// Helper function to get color class based on score
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

// Modal component for displaying match details
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
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-4 text-center">Match Details</h2>
                <p className="text-base sm:text-lg font-semibold mb-2">
                    <span className="text-[#5a9c68]">Seeker:</span> {seeker.name}
                </p>
                <p className="text-base sm:text-lg font-semibold mb-4">
                    <span className="text-[#cc8a2f]">Room Offer:</span> {room.name}
                </p>

                <div className={`mt-2 mb-6 px-4 py-2 rounded-full text-lg sm:text-xl font-bold text-center ${getScoreColorClass(matchDetails.totalScore)}`}>
                    Total Score: {matchDetails.totalScore !== undefined && matchDetails.totalScore !== null ? matchDetails.totalScore.toFixed(0) : 'N/A'}
                </div>

                <h3 className="text-xl text-gray-700 mb-3">Score Breakdown:</h3>
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
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

// Component for the chat list
const ChatList = ({ chats, onSelectChat, currentUserUid, allUserDisplayNamesMap }) => {
    return (
        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-xl w-full max-w-xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-6 text-center">My Chats</h2>
            {chats.length === 0 ? (
                <p className="text-center text-gray-600">No active chats yet. Start a chat from your matches!</p>
            ) : (
                <div className="space-y-3">
                    {chats.map(chat => {
                        const otherParticipantUid = chat.participantsUids.find(uid => uid !== currentUserUid);
                        const otherUserName = allUserDisplayNamesMap[otherParticipantUid] || 'Unknown User';
                        console.log(`ChatList: Chat ID ${chat.id}, Other UID: ${otherParticipantUid}, Name from Map: ${allUserDisplayNamesMap[otherParticipantUid]}`); // Debugging
                        return (
                            <div
                                key={chat.id}
                                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg shadow-sm cursor-pointer hover:bg-gray-100 transition"
                                onClick={() => onSelectChat(chat.id)}
                            >
                                <div className="flex-1">
                                    <p className="font-semibold text-gray-800">
                                        Chat with: {otherUserName}
                                    </p>
                                    {chat.initialContext && ( // Display initial context in chat list
                                        <p className="text-xs text-blue-600 mt-1">
                                            About: {chat.initialContext.profileName} ({capitalizeFirstLetter(chat.initialContext.type === 'room' ? 'Room Offer' : 'Seeker Profile')})
                                        </p>
                                    )}
                                    {chat.lastMessage && (
                                        <p className="text-sm text-gray-600 truncate">
                                            {chat.lastMessage.senderId === currentUserUid ? 'You: ' : ''}
                                            {chat.lastMessage.text}
                                        </p>
                                    )}
                                </div>
                                <span className="text-xs text-gray-500 ml-4">
                                    {chat.lastMessageTimestamp ? new Date(chat.lastMessageTimestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// Component for the chat conversation
const ChatConversation = ({ selectedChatId, onCloseChat, currentUserUid, otherUser, db, currentUserName }) => {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [chatInitialContext, setChatInitialContext] = useState(null); // NEW: State for initial chat context
    const messagesEndRef = useRef(null); // Ref for scrolling down

    // Fetch messages for the selected chat
    useEffect(() => {
        if (!db || !selectedChatId) return;

        const chatDocRef = doc(db, 'chats', selectedChatId);
        const messagesRef = collection(db, 'chats', selectedChatId, 'messages');
        const q = query(messagesRef, orderBy('timestamp'), limit(50)); // Limit to last 50 messages

        // Listener for the chat document itself to retrieve initialContext
        const unsubscribeChatDoc = onSnapshot(chatDocRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                setChatInitialContext(docSnapshot.data().initialContext || null);
            }
        }, (error) => {
            console.error("Error fetching chat document:", error);
        });

        // Listener for messages
        const unsubscribeMessages = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMessages(msgs);
        }, (error) => {
            console.error("Error fetching messages:", error);
            // In a real app, display an error to the user
        });

        return () => {
            unsubscribeChatDoc();
            unsubscribeMessages();
        };
    }, [db, selectedChatId]);

    // Scroll to the latest message when messages update
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
                timestamp: serverTimestamp(), // Use server timestamp for consistency
            });
            setNewMessage('');

            // Optional: Update lastMessage and lastMessageTimestamp in the parent chat document
            // This is a common pattern for chat list previews
            const chatDocRef = doc(db, 'chats', selectedChatId);
            await setDoc(chatDocRef, {
                lastMessage: {
                    senderId: currentUserUid,
                    text: newMessage,
                },
                lastMessageTimestamp: serverTimestamp(),
            }, { merge: true }); // Use merge to only update these fields
            
        } catch (error) {
            console.error("Error sending message:", error);
            // In a real app, display an error to the user
        }
    };

    return (
        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-xl w-full max-w-xl mx-auto flex flex-col h-[70vh]">
            <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-200">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800">
                    Chat with: {otherUser?.name || 'Unknown User'}
                </h2>
                <button onClick={onCloseChat} className="text-gray-500 hover:text-gray-700">
                    <XCircle size={24} />
                </button>
            </div>

            {chatInitialContext && ( // NEW: Display initial context
                <div className="bg-blue-50 text-blue-800 p-3 rounded-lg mb-4 text-sm text-center">
                    This chat was started via the {chatInitialContext.type === 'room' ? 'Room Offer' : 'Seeker Profile'} "
                    <span className="font-semibold">{chatInitialContext.profileName}</span>".
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
                                    ? 'bg-[#d0f6f0] text-gray-800' // Lighter green for sender
                                    : 'bg-gray-200 text-gray-800'
                            }`}
                        >
                            <p className="font-semibold text-sm mb-1">
                                {msg.senderId === currentUserUid ? currentUserName : otherUser?.name || 'Unknown User'}
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
                <div ref={messagesEndRef} /> {/* Dummy div for scrolling */}
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
                    placeholder="Enter message..."
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1]"
                />
                <button
                    onClick={handleSendMessage}
                    onTouchEnd={(e) => { // Added onTouchEnd for better mobile compatibility
                        e.preventDefault(); // Prevent default to avoid potential double-firing or touch issues
                        handleSendMessage();
                    }}
                    className="px-6 py-3 bg-[#3fd5c1] text-white font-bold rounded-r-lg shadow-md hover:bg-[#32c0ae] transition"
                >
                    Send
                </button>
            </div>
        </div>
    );
};

// Main Chat Page component (conditionally rendered in App.js)
const ChatPage = ({ db, currentUserUid, currentUserName, allSearcherProfilesGlobal, allRoomProfilesGlobal, initialChatTargetUid, setInitialChatTargetUid, initialChatTargetProfileId, setInitialChatTargetProfileId, initialChatTargetProfileName, setInitialChatTargetProfileName, initialChatTargetProfileType, setInitialChatTargetProfileType, allUserDisplayNamesMap }) => {
    const [chats, setChats] = useState([]);
    const [selectedChatId, setSelectedChatId] = useState(null);
    const [otherUser, setOtherUser] = useState(null);
    const [isLoadingChat, setIsLoadingChat] = useState(false);
    const [chatError, setChatError] = useState(null);

    // Effect 1: Handle initial chat target (when clicking chat button from a match)
    // This effect runs when initialChatTargetUid, currentUserUid, or db change.
    // It finds or creates a chat and sets the selectedChatId.
    useEffect(() => {
        const findOrCreateChat = async () => {
            // Only proceed if we have a target UID, current user's UID, and a ready DB
            // Also ensure it doesn't re-trigger unnecessarily if a chat is already selected or loading
            if (!db || !currentUserUid || !initialChatTargetUid || selectedChatId || isLoadingChat) return;

            setIsLoadingChat(true);
            setChatError(null);
            console.log("ChatPage: Attempting to find or create chat with target user UID:", initialChatTargetUid, "for profile:", initialChatTargetProfileName);

            try {
                const chatsRef = collection(db, 'chats');
                const participantUids = getSortedParticipantsUids(currentUserUid, initialChatTargetUid);

                // Query for existing chat where participantsUids array AND contextProfileId match exactly
                const q = query(
                    chatsRef,
                    where('participantsUids', '==', participantUids),
                    where('contextProfileId', '==', initialChatTargetProfileId) // NEW: Condition for profile ID
                );

                const querySnapshot = await getDocs(q);

                let chatToSelectId = null;
                if (!querySnapshot.empty) {
                    // Chat exists, select it
                    chatToSelectId = querySnapshot.docs[0].id;
                    console.log("ChatPage: Existing chat found with ID:", chatToSelectId);
                } else {
                    // Chat does not exist, create a new one
                    const newChatRef = await addDoc(chatsRef, {
                        participantsUids: participantUids, // Store sorted UIDs
                        createdAt: serverTimestamp(),
                        lastMessageTimestamp: serverTimestamp(), // Initialize timestamp for sorting
                        // NEW: Add profile context
                        initialContext: {
                            profileId: initialChatTargetProfileId,
                            profileName: initialChatTargetProfileName,
                            type: initialChatTargetProfileType,
                            initiatorUid: currentUserUid // Who initiated the chat
                        },
                        contextProfileId: initialChatTargetProfileId, // NEW: Field for querying
                        lastMessage: {
                            senderId: currentUserUid,
                            text: `I am interested in your ${initialChatTargetProfileType === 'room' ? 'Room Offer' : 'Seeker Profile'} '${initialChatTargetProfileName}'.`,
                        },
                    });
                    chatToSelectId = newChatRef.id;
                    console.log("ChatPage: New chat created with ID:", chatToSelectId);
                }

                setSelectedChatId(chatToSelectId);
                // Use the name from allUserDisplayNamesMap here
                const otherUserName = allUserDisplayNamesMap[initialChatTargetUid] || 'Unknown User';
                setOtherUser({ uid: initialChatTargetUid, name: otherUserName });
                console.log("ChatPage: Chat started with:", otherUserName, "(UID:", initialChatTargetUid, ") via profile:", initialChatTargetProfileName);
                console.log("ChatPage: allUserDisplayNamesMap at chat start:", allUserDisplayNamesMap); // Debugging
                console.log("ChatPage: Looked up name for target UID:", initialChatTargetUid, "is:", allUserDisplayNamesMap[initialChatTargetUid]); // Debugging

            } catch (error) {
                console.error("Error finding or creating chat:", error);
                setChatError("Could not start chat. Please try again.");
            } finally {
                setIsLoadingChat(false);
                // IMPORTANT: Clear initialChatTargetUid and profile context in the parent App component
                // This prevents this effect from re-running unnecessarily if ChatPage re-renders
                // and initialChatTargetUid is still set from a previous navigation.
                setInitialChatTargetUid(null);
                setInitialChatTargetProfileId(null); // New
                setInitialChatTargetProfileName(null); // New
                setInitialChatTargetProfileType(null); // New
            }
        };

        // Only trigger this effect if initialChatTargetUid is explicitly set by the parent App
        // and other conditions (db, currentUserUid) are met.
        if (initialChatTargetUid && currentUserUid && db) {
            findOrCreateChat();
        }
    }, [db, currentUserUid, initialChatTargetUid, initialChatTargetProfileId, initialChatTargetProfileName, initialChatTargetProfileType, allUserDisplayNamesMap, selectedChatId, isLoadingChat, setInitialChatTargetUid, setInitialChatTargetProfileId, setInitialChatTargetProfileName, setInitialChatTargetProfileType]);

    // Effect 2: Fetch user's chats for the list view
    // This effect only depends on core data needed to fetch the chat list.
    useEffect(() => {
        if (!db || !currentUserUid) return;

        const chatsRef = collection(db, 'chats');
        // Query chats where the current user is a participant
        const q = query(
            chatsRef,
            where('participantsUids', 'array-contains', currentUserUid),
            orderBy('lastMessageTimestamp', 'desc') // Order by last message for chat list
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedChats = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    // participants: participantsWithNames, // No longer needed as names are fetched from allUserDisplayNamesMap
                };
            });
            setChats(fetchedChats);
            console.log("ChatPage: Chat list fetched. Number of chats:", fetchedChats.length);
        }, (error) => {
            console.error("Error fetching chats:", error);
            setChatError("Error loading your chats.");
        });

        return () => unsubscribe();
    }, [db, currentUserUid]); // allUserDisplayNamesMap removed from dependencies as it's used in ChatList, not here

    const handleSelectChat = (chatId) => {
        setSelectedChatId(chatId);
        const selectedChat = chats.find(chat => chat.id === chatId);
        if (selectedChat) {
            // Find the other participant's profile
            const otherParticipantUid = selectedChat.participantsUids.find(uid => uid !== currentUserUid);
            const otherUserName = allUserDisplayNamesMap[otherParticipantUid] || 'Unknown User';
            setOtherUser({ uid: otherParticipantUid, name: otherUserName });
            console.log("ChatPage: Existing chat selected. Other user:", otherUserName, "(UID:", otherParticipantUid, ")");
            console.log("ChatPage: allUserDisplayNamesMap at chat select:", allUserDisplayNamesMap); // Debugging
            console.log("ChatPage: Looked up name for selected UID:", otherParticipantUid, "is:", allUserDisplayNamesMap[otherParticipantUid]); // Debugging
        }
    };

    const handleCloseChat = () => {
        setSelectedChatId(null);
        setOtherUser(null);
        // When closing a chat, also clear initialChatTargetUid in App.js
        // This is important if the user navigates back to the chat list from a specific chat
        // that was initiated via a "Start Chat" button.
        setInitialChatTargetUid(null); // IMPORTANT: Clear this in the parent App component
        setInitialChatTargetProfileId(null); // New
        setInitialChatTargetProfileName(null); // New
        setInitialChatTargetProfileType(null); // New
        console.log("ChatPage: Chat closed.");
    };

    if (isLoadingChat) {
        return (
            <div className="flex items-center justify-center h-[50vh] text-gray-700 text-lg animate-pulse">
                Loading chat...
            </div>
        );
    }

    if (chatError) {
        return (
            <div className="flex items-center justify-center h-[50vh] bg-red-100 text-red-700 p-4 rounded-lg">
                <p>Chat Error: {chatError}</p>
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
                    allUserDisplayNamesMap={allUserDisplayNamesMap} // Pass allUserDisplayNamesMap
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

// Main Roomatch application component
function App() {
    const [mySearcherProfiles, setMySearcherProfiles] = useState([]);
    const [myRoomProfiles, setMyRoomProfiles] = useState([]);
    const [allSearcherProfilesGlobal, setAllSearcherProfilesGlobal] = useState([]);
    const [allRoomProfilesGlobal, setAllRoomProfilesGlobal] = useState([]);

    const [matches, setMatches] = useState([]);
    const [reverseMatches, setReverseMatches] = useState([]);
    
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null); // Firebase Auth instance
    const [userId, setUserId] = useState(null);
    const [userName, setUserName] = useState(null); // State for user's display name
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showSeekerForm, setShowSeekerForm] = useState(true);
    const [saveMessage, setSaveMessage] = useState(''); // The content of the message
    const [showSaveMessageElement, setShowSaveMessageElement] = useState(false); // Controls opacity/visibility of the fixed element
    const [adminMode, setAdminMode] = useState(false);
    const [selectedMatchDetails, setSelectedMatchDetails] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false); // New state to track authentication readiness
    const [showUserIdCopied, setShowUserIdCopied] = useState(false); // State for copy message
    const [scrollToProfileId, setScrollToProfileId] = useState(null); // New state to scroll to a specific profile
    const [allUserDisplayNamesMap, setAllUserDisplayNamesMap] = useState({}); // NEW: Map for UID to DisplayName

    // New state for current view: 'home' (default profile creation/matches), 'chats', 'admin'
    const [currentView, setCurrentView] = useState('home');
    const [initialChatTargetUid, setInitialChatTargetUid] = useState(null); // UID of the user to chat with directly
    // NEW: States for initial profile context when starting a chat
    const [initialChatTargetProfileId, setInitialChatTargetProfileId] = useState(null);
    const [initialChatTargetProfileName, setInitialChatTargetProfileName] = useState(null);
    const [initialChatTargetProfileType, setInitialChatTargetProfileType] = useState(null);

    // Firebase Initialization and Authentication
    useEffect(() => {
        let appInstance, dbInstance, authInstance;

        try {
            appInstance = initializeApp(firebaseConfig);
            dbInstance = getFirestore(appInstance);
            authInstance = getAuth(appInstance);

            setDb(dbInstance);
            setAuth(authInstance);

            const unsubscribeAuth = onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    const displayName = user.displayName || user.email || 'Guest';
                    setUserName(displayName);
                    setAdminMode(user.uid === ADMIN_UID);

                    // NEW: Save/update user display name in Firestore
                    // This should always happen when a user logs in
                    try {
                        await setDoc(doc(dbInstance, 'users', user.uid), {
                            displayName: displayName,
                            lastSeen: serverTimestamp(),
                        }, { merge: true });
                        console.log(`App: Display name for UID ${user.uid} (${displayName}) saved to Firestore.`); // Debugging
                    } catch (e) {
                        console.error("Error saving user display name:", e);
                    }

                } else {
                    // No user logged in. Wait for explicit Google sign-in.
                    setUserId(null);
                    setUserName(null);
                    setAdminMode(false);
                }
                setIsAuthReady(true); // Authentication system is ready, regardless of login status
                setLoading(false); // Loading finished
            });

            return () => {
                unsubscribeAuth();
            };
        } catch (initError) {
            console.error("Firebase initialization error:", initError);
            setError("Firebase could not be initialized. Please check your Firebase configuration and internet connection.");
            setLoading(false);
        }
    }, []); // Empty dependency array, as this should only run once on app load

    // NEW: Separate useEffect for the user names map listener
    useEffect(() => {
        if (!db) return; // Wait until Firestore instance is available

        const usersCollectionRef = collection(db, 'users');
        const unsubscribeUsers = onSnapshot(usersCollectionRef, (snapshot) => {
            const namesMap = {};
            snapshot.docs.forEach(doc => {
                namesMap[doc.id] = doc.data().displayName;
            });
            setAllUserDisplayNamesMap(namesMap);
            console.log("App: allUserDisplayNamesMap updated:", namesMap); // Debugging output
        }, (err) => {
            console.error("Error fetching user display names:", err);
            // Optional: Error handling, e.g., setError('Error loading user names.');
        });

        return () => unsubscribeUsers(); // Cleanup function for the listener
    }, [db]); // Dependency on 'db'

    // Effect to scroll to a specific profile after it has been added/rendered
    useEffect(() => {
        if (scrollToProfileId) {
            const element = document.getElementById(`profile-${scrollToProfileId}`);
            if (element) {
                // Use a small delay to ensure the DOM has updated after state change
                setTimeout(() => {
                    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    // Only clear if the current scrollToProfileId matches,
                    // in case a new scroll request came in very quickly.
                    setScrollToProfileId(currentId => currentId === scrollToProfileId ? null : currentId);
                }, 100); // 100ms delay
            }
        }
    }, [scrollToProfileId]); // Dependencies now only include scrollToProfileId

    // Effect to handle showing and hiding the save message
    useEffect(() => {
        let timerFadeOut;
        let timerClearContent;

        if (saveMessage) {
            setShowSaveMessageElement(true); // Make element visible immediately

            // Start fading out after 2 seconds
            timerFadeOut = setTimeout(() => {
                setShowSaveMessageElement(false);
            }, 2000); // Message is fully visible for 2 seconds

            // Clear the message content after the fade-out transition is complete (2000ms + 500ms transition = 2500ms total)
            timerClearContent = setTimeout(() => {
                setSaveMessage('');
            }, 2500); // Clear the actual message content after the animation is visually complete

        } else {
            // If saveMessage becomes empty (e.g., from initial state or explicitly cleared elsewhere),
            // ensure the element is hidden and no timers are pending.
            setShowSaveMessageElement(false); // Ensure it's hidden if saveMessage is empty
        }

        return () => {
            clearTimeout(timerFadeOut);
            clearTimeout(timerClearContent);
        };
    }, [saveMessage]); // Only dependent on saveMessage

    // Function for Google Sign-In
    const handleGoogleSignIn = async () => {
        if (!auth) {
            setError("Authentication service not ready.");
            return;
        }
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            setError(null);
        } catch (error) {
            console.error("Google sign-in error:", error);
            // Improved error message for invalid API key
            if (error.code === 'auth/api-key-not-valid') {
                setError("Sign-in failed: The Firebase API key is invalid. Please check it in the Firebase Console.");
            } else {
                setError("Google sign-in failed: " + error.message);
            }
        }
    };

    // Function for Sign-Out
    const handleSignOut = async () => {
        if (!auth) {
            setError("Authentication service not ready for sign out.");
            return;
        }
        try {
            await signOut(auth);
            setUserId(null);
            setUserName(null);
            setAdminMode(false);
            setError(null);
            setCurrentView('home'); // Reset view on sign out
            setInitialChatTargetUid(null); // Clear target user on sign out
            setInitialChatTargetProfileId(null); // New
            setInitialChatTargetProfileName(null); // New
            setInitialChatTargetProfileType(null); // New
        } catch (error) {
            console.error("Sign-out error:", error);
            setError("Sign-out failed: " + error.message);
        }
    };

    // Function to copy UID to clipboard
    const copyUidToClipboard = () => {
        if (userId) {
            // Use document.execCommand for iFrame compatibility
            const textArea = document.createElement("textarea");
            textArea.value = userId;
            textArea.style.position = "fixed"; // Avoid scrolling down
            textArea.style.opacity = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                setShowUserIdCopied(true);
                setTimeout(() => setShowUserIdCopied(false), 2000);
            } catch (err) {
                console.error('Fallback: Oops, could not copy', err);
                // In a real app, a user-friendly message could be displayed instead
            } finally {
                document.body.removeChild(textArea);
            }
        }
    };

    // When admin mode is toggled, ensure the form is reset to 'Seeker Profile'
    useEffect(() => {
        if (!adminMode) {
            setShowSeekerForm(true);
            setCurrentView('home'); // Go back to home view if admin mode is deactivated
            setInitialChatTargetUid(null); // Clear target user
            setInitialChatTargetProfileId(null); // New
            setInitialChatTargetProfileName(null); // New
            setInitialChatTargetProfileType(null); // New
        }
    }, [adminMode]);

    // Helper function to get collection path (simplified for root-level collections as per rules)
    const getCollectionRef = useCallback((collectionName) => {
        if (!db) {
            console.warn("Attempting to get collection reference before Firestore DB is initialized.");
            return null;
        }
        return collection(db, collectionName);
    }, [db]);

    // Real-time data fetching for *own* seeker profiles from Firestore
    useEffect(() => {
        // Only fetch if DB is ready, authentication is ready, and a user is logged in
        if (!db || !userId || !isAuthReady) return;
        let unsubscribe;
        const timer = setTimeout(() => {
            const collectionRef = getCollectionRef(`searcherProfiles`);
            if (!collectionRef) {
                console.error("Collection reference for searcher profiles is null after delay.");
                return;
            }
            const mySearchersQuery = query(collectionRef, where('createdBy', '==', userId));
            unsubscribe = onSnapshot(mySearchersQuery, (snapshot) => {
                const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setMySearcherProfiles(profiles);
            }, (err) => {
                console.error("Error fetching own seeker profiles:", err);
                setError("Error loading your seeker profiles.");
            });
        }, 100);

        return () => {
            clearTimeout(timer);
            if (unsubscribe) unsubscribe();
        };
    }, [db, userId, isAuthReady, getCollectionRef]);

    const [myNewRoomProfilesData, setMyNewRoomProfilesData] = useState([]); 
    const [myOldWgProfilesData, setMyOldWgProfilesData] = useState([]);

    // Real-time data fetching for *own* room profiles from Firestore
    useEffect(() => {
        // Only fetch if DB is ready, authentication is ready, and a user is logged in
        if (!db || !userId || !isAuthReady) return;
        let unsubscribeMyNewRooms;
        let unsubscribeMyOldWgs;

        const timer = setTimeout(() => {
            // Fetch from 'roomProfiles' (new)
            const newRoomsCollectionRef = getCollectionRef(`roomProfiles`);
            if (newRoomsCollectionRef) {
                const myRoomsQuery = query(newRoomsCollectionRef, where('createdBy', '==', userId));
                unsubscribeMyNewRooms = onSnapshot(myRoomsQuery, (snapshot) => {
                    const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), isLegacy: false }));
                    setMyNewRoomProfilesData(profiles);
                }, (err) => {
                    console.error("Error fetching own new room profiles:", err);
                    setError("Error loading your room profiles.");
                });
            } else {
                console.error("Collection reference for roomProfiles is null after delay.");
            }

            // Fetch from 'wgProfiles' (old)
            const oldWgsCollectionRef = getCollectionRef(`wgProfiles`);
            if (oldWgsCollectionRef) {
                const myWgsQuery = query(oldWgsCollectionRef, where('createdBy', '==', userId));
                unsubscribeMyOldWgs = onSnapshot(myWgsQuery, (snapshot) => {
                    const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), isLegacy: true }));
                    setMyOldWgProfilesData(profiles);
                }, (err) => {
                    console.error("Error fetching own old WG profiles:", err);
                });
            } else {
                console.error("Collection reference for wgProfiles is null after delay.");
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

    // Real-time data fetching for *all* seeker profiles (for match calculation)
    useEffect(() => {
        // Only fetch if DB is ready, authentication is ready, and a user is logged in (or admin mode)
        // If authentication is not ready or user is not logged in, these listeners should not be active
        if (!db || !isAuthReady || (!userId && !adminMode)) {
            setAllSearcherProfilesGlobal([]); // Clear global profiles if not authorized to fetch
            return;
        }; 
        let unsubscribe;
        const timer = setTimeout(() => {
            const collectionRef = getCollectionRef(`searcherProfiles`);
            if (!collectionRef) {
                console.error("Collection reference for all searcher profiles is null after delay.");
                return;
            }
            const allSearchersQuery = query(collectionRef);
            unsubscribe = onSnapshot(allSearchersQuery, (snapshot) => {
                const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setAllSearcherProfilesGlobal(profiles);
            }, (err) => {
                console.error("Error fetching all seeker profiles (global):", err);
            });
        }, 100);

        return () => {
            clearTimeout(timer);
            if (unsubscribe) unsubscribe();
        };
    }, [db, userId, isAuthReady, adminMode, getCollectionRef]); // userId and adminMode added to dependencies

    // Real-time data fetching for *all* room profiles (for match calculation - combining new and old collections)
    useEffect(() => {
        // Only fetch if DB is ready, authentication is ready, and a user is logged in (or admin mode)
        // If authentication is not ready or user is not logged in, these listeners should not be active
        if (!db || !isAuthReady || (!userId && !adminMode)) {
            setNewRoomProfilesData([]); // Clear global profiles if not authorized to fetch
            setOldWgProfilesData([]); // Clear global profiles if not authorized to fetch
            return;
        };
        let unsubscribeNewRooms;
        let unsubscribeOldWgs;

        const timer = setTimeout(() => {
            // Fetch from 'roomProfiles' (new)
            const newRoomsCollectionRef = getCollectionRef(`roomProfiles`);
            if (newRoomsCollectionRef) {
                const roomProfilesQuery = query(newRoomsCollectionRef);
                unsubscribeNewRooms = onSnapshot(roomProfilesQuery, (roomSnapshot) => {
                    const profiles = roomSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), isLegacy: false }));
                    setNewRoomProfilesData(profiles);
                }, (err) => {
                    console.error("Error fetching all room profiles (new collection):", err);
                });
            } else {
                console.error("Collection reference for roomProfiles (global) is null after delay.");
            }

            // Fetch from 'wgProfiles' (old)
            const oldWgsCollectionRef = getCollectionRef(`wgProfiles`);
            if (oldWgsCollectionRef) {
                const wgProfilesQuery = query(oldWgsCollectionRef);
                unsubscribeOldWgs = onSnapshot(wgProfilesQuery, (wgSnapshot) => {
                    const profiles = wgSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), isLegacy: true }));
                    setOldWgProfilesData(profiles);
                }, (err) => {
                    console.error("Error fetching all room profiles (old WG collection):", err);
                });
            } else {
                console.error("Collection reference for wgProfiles (global) is null after delay.");
            }
        }, 100);

        return () => {
            clearTimeout(timer);
            if (unsubscribeNewRooms) unsubscribeNewRooms();
            if (unsubscribeOldWgs) unsubscribeOldWgs();
        };
    }, [db, userId, isAuthReady, adminMode, getCollectionRef]); // userId and adminMode added to dependencies

    useEffect(() => {
        setAllRoomProfilesGlobal([...newRoomProfilesData, ...oldWgProfilesData]);
    }, [newRoomProfilesData, oldWgProfilesData]);

    // Match calculation for both directions
    useEffect(() => {
        const calculateAllMatches = () => {
            const newSeekerToRoomMatches = [];
            // Matches are only calculated for logged-in users or in admin mode
            const seekersForMatching = (adminMode || userId) ? allSearcherProfilesGlobal : [];
            
            seekersForMatching.forEach(searcher => {
                const matchingRooms = allRoomProfilesGlobal.map(room => {
                    const matchResult = calculateMatchScore(searcher, room);
                    return { room: room, score: matchResult.totalScore, breakdownDetails: matchResult.details, fullMatchResult: matchResult };
                }).filter(match => match.score > -999998); // Filter out disqualifying matches
                
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
                }).filter(match => match.score > -999998); // Filter out disqualifying matches
                
                matchingSeekers.sort((a, b) => b.score - a.score);
                newRoomToSeekerMatches.push({ room: room, matchingSeekers: matchingSeekers.slice(0, 10) });
            });
            setReverseMatches(newRoomToSeekerMatches);
        };

        // Calculate matches only if DB is ready, authentication is ready AND user is logged in or in admin mode
        if (db && isAuthReady && (userId || adminMode)) {
            calculateAllMatches();
        } else {
            // Clear matches if not authorized to calculate/display
            setMatches([]);
            setReverseMatches([]);
        }
    }, [allSearcherProfilesGlobal, allRoomProfilesGlobal, adminMode, userId, db, isAuthReady]);

    // Function to add a seeker profile to Firestore
    const addSearcherProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Database not ready or not logged in. Please wait or log in.");
            return;
        }
        try {
            const collectionRef = getCollectionRef(`searcherProfiles`);
            if (!collectionRef) {
                setError("Could not get collection reference for seeker profiles.");
                return;
            }
            const docRef = await addDoc(collectionRef, {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId, // Link profile to USER_ID
            });
            setSaveMessage('Seeker profile saved successfully!');
            setScrollToProfileId(docRef.id); // Set ID for scrolling
            setShowSeekerForm(true); // Ensure seeker form tab is active after creation
        } catch (e) {
            console.error("Error adding seeker profile: ", e);
            setError("Error saving seeker profile.");
        }
    };

    // Function to add a room profile to Firestore
    const addRoomProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Database not ready or not logged in. Please wait or log in.");
            return;
        }
        try {
            const collectionRef = getCollectionRef(`roomProfiles`);
            if (!collectionRef) {
                setError("Could not get collection reference for room profiles.");
                return;
            }
            const docRef = await addDoc(collectionRef, {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId, // Link profile to USER_ID
            });
            setSaveMessage('Room offer saved successfully!');
            setScrollToProfileId(docRef.id); // Set ID for scrolling
            setShowSeekerForm(false); // Ensure room form tab is active after creation
        } catch (e) {
            console.error("Error adding room profile: ", e);
            setError("Error saving room profile.");
        }
    };

    // Function to delete a profile
    const handleDeleteProfile = async (collectionName, docId, profileName, profileCreatorId) => {
        if (!db || !userId) {
            setError("Database not ready for deletion or not logged in.");
            return;
        }

        if (!adminMode && userId !== profileCreatorId) {
            setError("You are not authorized to delete this profile.");
            setTimeout(() => setError(''), 3000);
            return;
        }

        try {
            const collectionRef = getCollectionRef(collectionName);
            if (!collectionRef) {
                setError(`Could not get collection reference for ${collectionName}.`);
                return;
            }
            await deleteDoc(doc(collectionRef, docId));
            setSaveMessage(`Profile "${profileName}" deleted successfully!`);
        } catch (e) {
            console.error(`Error deleting profile ${profileName}: `, e);
            setError(`Error deleting profile "${profileName}".`);
        }
    };

    // Function to navigate to chat with a specific user (their profile UID)
    // Now with additional parameters for profile context
    const handleStartChat = useCallback((targetUserUid, targetProfileId, targetProfileName, typeOfTargetProfile) => {
        if (!userId) {
            setError("Please log in to start a chat.");
            return;
        }
        if (userId === targetUserUid) {
            setError("You cannot chat with yourself.");
            setTimeout(() => setError(''), 3000); // Clear error after 3 seconds
            return;
        }
        console.log("App: Calling handleStartChat with targetUserUid:", targetUserUid, "Target Profile ID:", targetProfileId, "Target Profile Name:", targetProfileName, "Type:", typeOfTargetProfile);
        // Set the initial chat target information
        setInitialChatTargetUid(targetUserUid);
        setInitialChatTargetProfileId(targetProfileId); // New
        setInitialChatTargetProfileName(targetProfileName); // New
        setInitialChatTargetProfileType(typeOfTargetProfile); // New
        setCurrentView('chats'); // Switch to chat view
    }, [userId]); // Dependencies updated

    // Unified Profile Form Component
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
                    {type === 'seeker' ? `Create Seeker Profile (Step ${currentStep}/${totalSteps})` : `Create Room Offer (Step ${currentStep}/${totalSteps})`}
                </h2>

                {/* --- STEP 1 --- */}
                {currentStep === 1 && (
                    <div className="space-y-4">
                        {/* Name / Room Name */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">
                                {type === 'seeker' ? 'Your Name:' : 'Room Name:'}
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

                        {/* Age (Seeker) / Age Range (Provider) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Your Age:</label>
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
                                    <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Min. Flatmate Age:</label>
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
                                    <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Max. Flatmate Age:</label>
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

                        {/* Gender (Seeker) / Gender Preference (Provider) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Your Gender:</label>
                                <select
                                    name="gender"
                                    value={formState.gender}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                >
                                    <option value="male">Male</option>
                                    <option value="female">Female</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2 flex items-center">
                                    Gender Preference for Flatmates:
                                    <div
                                        className="relative ml-2 cursor-pointer text-red-500 hover:text-red-700"
                                        onMouseEnter={() => setShowGenderTooltip(true)}
                                        onMouseLeave={() => setShowGenderTooltip(false)}
                                    >
                                        <Info size={18} />
                                        {showGenderTooltip && (
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 max-w-[calc(100vw-2rem)] p-3 bg-red-100 text-red-800 text-sm rounded-lg shadow-lg z-10 border border-red-300 sm:left-full sm:translate-x-0 sm:ml-2 sm:mt-0">
                                                Selecting "Male" or "Female" will exclude seekers of the other gender from your search results.
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
                                    <option value="any">Any</option>
                                    <option value="male">Male</option>
                                    <option value="female">Female</option>
                                </select>
                            </div>
                        )}

                        {/* Location / District (for both) */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Location / District:</label>
                            <select
                                name="location"
                                value={formState.location}
                                onChange={handleChange}
                                required
                                className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                            >
                                <option value="Cologne">Cologne</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* --- STEP 2 --- */}
                {currentStep === 2 && (
                    <div className="space-y-4">
                        {/* Maximum Rent (Seeker) / Rent (Provider) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Maximum Rent (€):</label>
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
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Rent (€):</label>
                                <input
                                    type="number"
                                    name="rent"
                                    value={formState.rent}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                />
                            </div>
                        )}

                        {/* Pets (Seeker) / Pets Allowed (Provider) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Pets:</label>
                                <select
                                    name="pets"
                                    value={formState.pets}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                >
                                    <option value="any">Any</option>
                                    <option value="yes">Yes</option>
                                    <option value="no">No</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Pets Allowed:</label>
                                <select
                                    name="petsAllowed"
                                    value={formState.petsAllowed}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                >
                                    <option value="any">Any</option>
                                    <option value="yes">Yes</option>
                                    <option value="no">No</option>
                                </select>
                            </div>
                        )}

                        {/* Personality Traits (for both) */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">
                                {type === 'seeker' ? 'Your Personality Traits:' : 'Current Residents\' Personality Traits:'}
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

                        {/* Interests (for both) */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">
                                {type === 'seeker' ? 'Your Interests:' : 'Current Residents\' Interests:'}
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

                        {/* New: Communal Living Preferences */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">
                                {type === 'seeker' ? 'Your Communal Living Preferences:' : 'Communal Living Preferences for the Room:'}
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

                {/* --- STEP 3 --- */}
                {currentStep === 3 && (
                    <div className="space-y-4">
                        {/* What is sought (Seeker) / Room Description (Provider) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">What are you looking for in a room?:</label>
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
                                    <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Room Description:</label>
                                    <textarea
                                        name="description"
                                        value={formState.description}
                                        onChange={handleChange}
                                        rows="3"
                                        className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                    ></textarea>
                                </div>
                                <div>
                                    <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">What are you looking for in a new flatmate?:</label>
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
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Room Type:</label>
                                <select
                                    name="roomType"
                                    value={formState.roomType}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                >
                                    <option value="Single Room">Single Room</option>
                                    <option value="Double Room">Double Room</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Average Age of Residents:</label>
                                <input
                                    type="number"
                                    name="avgAge"
                                    value={formState.avgAge}
                                    onChange={handleChange}
                                    className="w-full px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200 text-sm sm:text-base"
                                />
                            </div>
                        )}

                        {/* New: Values */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">
                                {type === 'seeker' ? 'Your Values and Expectations for Flat-sharing:' : 'Room Values and Expectations:'}
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
                        <XCircle size={18} className="mr-1 sm:mr-2" /> Cancel
                    </button>
                    {currentStep > 1 && (
                        <button
                            type="button"
                            onClick={prevStep}
                            className="flex items-center px-4 py-2 sm:px-6 sm:py-3 bg-gray-300 text-gray-800 font-bold rounded-xl shadow-md hover:bg-gray-400 transition duration-150 ease-in-out transform hover:-translate-y-0.5 text-sm sm:text-base"
                        >
                            Back
                        </button>
                    )}
                    {currentStep < totalSteps ? (
                        <button
                            type="button"
                            onClick={nextStep}
                            className="flex items-center px-4 py-2 sm:px-6 sm:py-3 bg-[#3fd5c1] text-white font-bold rounded-xl shadow-lg hover:bg-[#32c0ae] transition duration-150 ease-in-out transform hover:-translate-y-0.5 text-sm sm:text-base"
                        >
                            Next
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
                            <CheckCircle size={18} className="mr-1 sm:mr-2" /> Save Profile
                        </button>
                    )}
                </div>
            </form>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#3fd5c1] to-[#e0f7f4]">
                <p className="text-gray-700 text-lg animate-pulse">Loading app and data...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-red-100 text-red-700 p-4 rounded-lg">
                <p>Error: {error}</p>
            </div>
        );
    }

    const showMySeekerDashboard = mySearcherProfiles.length > 0 && !adminMode;
    const showMyRoomDashboard = myRoomProfiles.length > 0 && !adminMode;

    return (
        // Adjusted padding for the main app container
        <div className="min-h-screen bg-[#3fd5c1] pt-8 sm:pt-12 p-4 font-inter flex flex-col items-center relative overflow-hidden">
            {/* Background circles for visual dynamism */}
            <div className="absolute top-[-50px] left-[-50px] w-48 h-48 bg-white opacity-10 rounded-full animate-blob-slow"></div>
            <div className="absolute bottom-[-50px] right-[-50px] w-64 h-64 bg-white opacity-10 rounded-full animate-blob-medium"></div>
            <div className="absolute top-1/3 right-1/4 w-32 h-32 bg-white opacity-10 rounded-full animate-blob-fast"></div>

            {/* Header: Logo and User Info / Login / Logout */}
            <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 sm:mb-8 text-center drop-shadow-lg">Roomatch</h1>
            
            <div className="bg-[#c3efe8] text-[#0a665a] text-xs sm:text-sm px-4 py-2 sm:px-6 sm:py-3 rounded-full mb-6 sm:mb-8 shadow-md flex flex-col sm:flex-row items-center transform transition-all duration-300 hover:scale-[1.02] text-center">
                {userId ? (
                    <>
                        <span className="mb-1 sm:mb-0 sm:mr-2 flex items-center">
                            <User size={16} className="mr-1" /> Logged in as: <span className="font-semibold ml-1">{userName}</span>
                        </span>
                        {/* User ID and Copy Button */}
                        <div className="flex items-center ml-2 sm:ml-4 relative">
                            <span className="font-mono text-xs break-all ml-1 sm:ml-2">UID: {userId}</span>
                            <button
                                onClick={copyUidToClipboard}
                                className="ml-2 p-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                                title="Copy User ID"
                            >
                                <Copy size={14} />
                            </button>
                            {showUserIdCopied && (
                                <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-700 text-white text-xs px-2 py-1 rounded-md animate-fade-in-out">
                                    Copied!
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
                                <span className="ml-2 text-[#0a665a] font-bold select-none">Admin Mode</span>
                            </label>
                        )}
                        <button
                            onClick={handleSignOut}
                            className="ml-4 sm:ml-6 px-3 py-1.5 sm:px-4 sm:py-2 bg-gray-200 text-gray-700 font-bold rounded-lg shadow-md hover:bg-gray-300 transition duration-150 ease-in-out flex items-center text-sm"
                        >
                            <LogOut size={16} className="mr-1.5" /> Sign Out
                        </button>
                    </>
                ) : (
                    <>
                        <span className="mb-1 sm:mb-0 sm:mr-2 flex items-center">
                            <User size={16} className="mr-1" /> Not logged in.
                        </span>
                        <button
                            onClick={handleGoogleSignIn}
                            className="ml-4 sm:ml-6 px-3 py-1.5 sm:px-4 sm:py-2 bg-white text-[#3fd5c1] font-bold rounded-lg shadow-md hover:bg-gray-100 transition duration-150 ease-in-out flex items-center text-sm"
                        >
                            <LogIn size={16} className="mr-1.5" /> Sign in with Google
                        </button>
                    </>
                )}
            </div>

            {/* Success message displayed as a fixed overlay */}
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

            {/* Main Navigation Buttons (Home/Chats) */}
            {userId && !adminMode && ( // Only show navigation if logged in and not in admin mode
                <div className="w-full max-w-6xl mx-auto flex justify-center space-x-4 mb-8">
                    <button
                        onClick={() => { setCurrentView('home'); setInitialChatTargetUid(null); setInitialChatTargetProfileId(null); setInitialChatTargetProfileName(null); setInitialChatTargetProfileType(null); }}
                        className={`px-6 py-3 rounded-xl text-lg font-semibold shadow-md transition-all duration-300 transform hover:scale-105 ${
                            currentView === 'home' ? 'bg-white text-[#3fd5c1]' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        <HomeIcon className="inline-block mr-2" size={20} /> Home
                    </button>
                    <button
                        onClick={() => { setCurrentView('chats'); setInitialChatTargetUid(null); setInitialChatTargetProfileId(null); setInitialChatTargetProfileName(null); setInitialChatTargetProfileType(null); }} // Reset targetUid when clicking 'Chats'
                        className={`px-6 py-3 rounded-xl text-lg font-semibold shadow-md transition-all duration-300 transform hover:scale-105 ${
                            currentView === 'chats' ? 'bg-white text-[#3fd5c1]' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        <MessageSquareText className="inline-block mr-2" size={20} /> Chats
                    </button>
                </div>
            )}

            {/* Main Content Wrapper - Top margin removed as global padding handles it */}
            <div className="w-full max-w-6xl flex flex-col items-center">
                {/* Conditional rendering based on currentView */}
                {adminMode ? (
                    // ADMIN MODE ON: Display all admin dashboards
                    <div className="w-full max-w-6xl flex flex-col gap-8 sm:gap-12">
                        {/* Admin Matches: Seeker Finds Room */}
                        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">Matches: Seeker Finds Room (Admin View)</h2>
                            {matches.length === 0 ? (
                                <p className="text-center text-gray-600 text-base sm:text-lg py-4">No matches found.</p>
                            ) : (
                                <div className="space-y-6 sm:space-y-8">
                                    {matches.map((searcherMatch, index) => {
                                        const profile = searcherMatch.searcher; // Define profile here
                                        const profileMatches = searcherMatch; // Define profileMatches here
                                        return (
                                            <div key={index} className="bg-[#f0f8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                                <h3 className="text-xl sm:text-2xl font-bold text-[#333333] mb-3 sm:mb-4 flex items-center">
                                                    <Search size={20} className="mr-2 sm:mr-3 text-[#5a9c68]" /> Seeker Name: <span className="font-extrabold ml-1 sm:ml-2">{searcherMatch.searcher.name}</span> <span className="text-sm font-normal text-gray-600 ml-1">(ID: {searcherMatch.searcher.id.substring(0, 8)}...)</span>
                                                </h3>
                                                <h4 className="text-lg sm:text-xl font-bold text-[#5a9c68] mt-6 sm:mt-8 mb-3 sm:mb-4 flex items-center">
                                                    <Heart size={18} className="mr-1 sm:mr-2" /> Matching Room Offers:
                                                </h4>
                                                <div className="space-y-2">
                                                    {profileMatches && profileMatches.matchingRooms.length > 0 ? (
                                                        profileMatches.matchingRooms.map(roomMatch => (
                                                            <div key={roomMatch.room.id} className="bg-white p-4 sm:p-5 rounded-lg shadow border border-[#9adfaa] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                                <div>
                                                                    <p className="font-bold text-gray-800 text-base md:text-lg">Room Name: {roomMatch.room.name}</p>
                                                                    <div className="flex items-center mt-1 sm:mt-2">
                                                                        <div className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold inline-block ${getScoreColorClass(roomMatch.score)}`}>
                                                                            Score: {roomMatch.score.toFixed(0)}
                                                                        </div>
                                                                        <button
                                                                            onClick={() => setSelectedMatchDetails({ seeker: profile, room: roomMatch.room, matchDetails: roomMatch.fullMatchResult })}
                                                                            className="ml-2 sm:ml-3 p-2 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition min-w-[44px] min-h-[44px] flex items-center justify-center"
                                                                            title="Show Match Details"
                                                                        >
                                                                            <Info size={16} />
                                                                        </button>
                                                                        {userId && roomMatch.room.createdBy !== userId && ( // Don't show chat with self
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    console.log("App: onClick fired for Seeker Matches chat button.");
                                                                                    handleStartChat(roomMatch.room.createdBy, roomMatch.room.id, roomMatch.room.name, 'room');
                                                                                }}
                                                                                onTouchEnd={(e) => {
                                                                                    e.preventDefault(); // Prevent default to avoid double-firing if onClick is also triggered
                                                                                    console.log("App: onTouchEnd fired for Seeker Matches chat button.");
                                                                                    handleStartChat(roomMatch.room.createdBy, roomMatch.room.id, roomMatch.room.name, 'room');
                                                                                }}
                                                                                className="ml-2 sm:ml-3 p-2 rounded-full bg-[#9adfaa] text-white hover:bg-[#85c292] transition min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
                                                                                title="Start chat with Room Creator"
                                                                            >
                                                                                <MessageSquareText size={16} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    <p className="text-sm md:text-base text-gray-600 mt-1 mb-0.5 leading-tight"><span className="font-medium">Desired Age:</span> {roomMatch.room.minAge}-{roomMatch.room.maxAge}, <span className="font-medium">Gender Preference:</span> {capitalizeFirstLetter(roomMatch.room.genderPreference)}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Rent:</span> {roomMatch.room.rent}€, <span className="font-medium">Room Type:</span> {capitalizeFirstLetter(roomMatch.room.roomType)}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Pets Allowed:</span> {capitalizeFirstLetter(roomMatch.room.petsAllowed === 'yes' ? 'Yes' : 'No')}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Residents' Interests:</span> {Array.isArray(roomMatch.room.interests) ? roomMatch.room.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.interests || 'N/A')}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Personality:</span> {Array.isArray(roomMatch.room.personalityTraits) ? roomMatch.room.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.personalityTraits || 'N/A')}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Communal Living:</span> {Array.isArray(roomMatch.room.roomCommunalLiving) ? roomMatch.room.roomCommunalLiving.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomCommunalLiving || 'N/A')}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-1 leading-tight"><span className="font-medium">Room Values:</span> {Array.isArray(roomMatch.room.roomValues) ? roomMatch.room.roomValues.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomValues || 'N/A')}</p>
                                                                </div>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <p className="text-gray-600 text-sm lg:text-base">No matching rooms for this profile.</p>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Admin Matches: Room Finds Seeker */}
                        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">Matches: Room Finds Seeker (Admin View)</h2>
                            {reverseMatches.length === 0 ? (
                                <p className="text-center text-gray-600 text-base sm:text-lg py-4">No matches found.</p>
                            ) : (
                                <div className="space-y-6 sm:space-y-8">
                                    {reverseMatches.map((roomMatch, index) => {
                                        const profile = roomMatch.room; // Define profile here
                                        const profileMatches = roomMatch; // Define profileMatches here
                                        return (
                                            <div key={index} className="bg-[#fff8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#fecd82] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                                <h3 className="text-xl sm:text-2xl font-bold text-[#333333] mb-3 sm:mb-4 flex items-center">
                                                    <HomeIcon size={20} className="mr-2 sm:mr-3 text-[#cc8a2f]" /> Room Name: <span className="font-extrabold ml-1 sm:ml-2">{roomMatch.room.name}</span> <span className="text-sm font-normal text-gray-600 ml-1">(ID: {roomMatch.room.id.substring(0, 8)}...)</span>
                                                </h3>
                                                <h4 className="text-lg sm:text-xl font-bold text-[#cc8a2f] mt-6 sm:mt-8 mb-3 sm:mb-4 flex items-center">
                                                    <Users size={18} className="mr-1 sm:mr-2" /> Matching Seekers:
                                                </h4>
                                                <div className="space-y-2">
                                                    {profileMatches && profileMatches.matchingSeekers.length > 0 ? (
                                                        profileMatches.matchingSeekers.map(seekerMatch => (
                                                            <div key={seekerMatch.searcher.id} className="bg-white p-4 sm:p-5 rounded-lg shadow border border-[#fecd82] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                                <div>
                                                                    <p className="font-bold text-gray-800 text-base md:text-lg">Seeker: {seekerMatch.searcher.name}</p>
                                                                    <div className="flex items-center mt-1 sm:mt-2">
                                                                        <div className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold inline-block ${getScoreColorClass(seekerMatch.score)}`}>
                                                                            Score: {seekerMatch.score.toFixed(0)}
                                                                        </div>
                                                                        <button
                                                                            onClick={() => setSelectedMatchDetails({ seeker: seekerMatch.searcher, room: profile, matchDetails: seekerMatch.fullMatchResult })}
                                                                            className="ml-2 sm:ml-3 p-2 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition min-w-[44px] min-h-[44px] flex items-center justify-center"
                                                                            title="Show Match Details"
                                                                        >
                                                                            <Info size={16} />
                                                                        </button>
                                                                        {userId && seekerMatch.searcher.createdBy !== userId && ( // Don't show chat with self
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    console.log("App: onClick fired for Room Matches chat button.");
                                                                                    handleStartChat(seekerMatch.searcher.createdBy, seekerMatch.searcher.id, seekerMatch.searcher.name, 'seeker');
                                                                                }}
                                                                                onTouchEnd={(e) => {
                                                                                    e.preventDefault(); // Prevent default to avoid double-firing if onClick is also triggered
                                                                                    console.log("App: onTouchEnd fired for Room Matches chat button.");
                                                                                    handleStartChat(seekerMatch.searcher.createdBy, seekerMatch.searcher.id, seekerMatch.searcher.name, 'seeker');
                                                                                }}
                                                                                className="ml-2 sm:ml-3 p-2 rounded-full bg-[#fecd82] text-white hover:bg-[#e6b772] transition min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
                                                                                title="Start chat with Seeker"
                                                                            >
                                                                                <MessageSquareText size={16} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    <p className="text-sm md:text-base text-gray-600 mt-1 mb-0.5 leading-tight"><span className="font-medium">Age:</span> {seekerMatch.searcher.age}, <span className="font-medium">Gender:</span> {capitalizeFirstLetter(seekerMatch.searcher.gender)}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Interests:</span> {Array.isArray(seekerMatch.searcher.interests) ? seekerMatch.searcher.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.interests || 'N/A')}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Personality:</span> {Array.isArray(seekerMatch.searcher.personalityTraits) ? seekerMatch.searcher.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.personalityTraits || 'N/A')}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Room Preferences:</span> {Array.isArray(seekerMatch.searcher.communalLivingPreferences) ? seekerMatch.searcher.communalLivingPreferences.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.communalLivingPreferences || 'N/A')}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-1 leading-tight"><span className="font-medium">Values:</span> {Array.isArray(seekerMatch.searcher.values) ? seekerMatch.searcher.values.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.values || 'N/A')}</p>
                                                                </div>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <p className="text-center text-gray-600 text-sm lg:text-base">No matching seekers for this room profile.</p>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        {/* All Seeker Profiles (Admin View) */}
                        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">All Seeker Profiles (Admin View)</h2>
                            {allSearcherProfilesGlobal.length === 0 ? (
                                <p className="text-center text-gray-600 text-base sm:text-lg py-4">No seeker profiles available yet.</p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {allSearcherProfilesGlobal.map(profile => (
                                        <div key={profile.id} className="bg-[#f0f8f0] p-5 sm:p-6 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                            <p className="font-bold text-[#333333] text-base md:text-lg mb-2">Name: {profile.name}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Age:</span> {profile.age}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Gender:</span> {capitalizeFirstLetter(profile.gender)}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Interests:</span> {Array.isArray(profile.interests) ? profile.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.interests || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Personality:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.personalityTraits || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Communal Living:</span> {Array.isArray(profile.communalLivingPreferences) ? profile.communalLivingPreferences.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.communalLivingPreferences || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-1 leading-tight"><span className="font-medium">Values:</span> {Array.isArray(profile.values) ? profile.values.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.values || 'N/A')}</p>
                                            <p className="text-xs text-gray-500 mt-3 sm:mt-4">Created by: {profile.createdBy}</p>
                                            <p className="text-xs text-gray-500">On: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                                            <button
                                                onClick={() => handleDeleteProfile('searcherProfiles', profile.id, profile.name, profile.createdBy)}
                                                className="mt-4 sm:mt-6 px-4 py-1.5 sm:px-5 sm:py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out self-end flex items-center transform hover:-translate-y-0.5 text-sm"
                                            >
                                                <Trash2 size={14} className="mr-1.5" /> Delete
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* All Room Offers (Admin View) */}
                        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-8 sm:mb-12">
                            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">All Room Offers (Admin View)</h2>
                            {allRoomProfilesGlobal.length === 0 ? (
                                <p className="text-center text-gray-600 text-base sm:text-lg py-4">No room offers available yet.</p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {allRoomProfilesGlobal.map(profile => (
                                        <div key={profile.id} className="bg-[#fff8f0] p-5 sm:p-6 rounded-xl shadow-lg border border-[#fecd82] flex flex-col transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                            <p className="font-bold text-[#333333] text-base md:text-lg mb-2">Room Name: {profile.name}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Rent:</span> {profile.rent}€</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Room Type:</span> {capitalizeFirstLetter(profile.roomType)}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Pets Allowed:</span> {capitalizeFirstLetter(profile.petsAllowed === 'yes' ? 'Yes' : 'No')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Average Age of Residents:</span> {profile.avgAge}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Residents' Interests:</span> {Array.isArray(profile.interests) ? profile.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.interests || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Personality:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.personalityTraits || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-medium">Communal Living:</span> {Array.isArray(profile.roomCommunalLiving) ? profile.roomCommunalLiving.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.roomCommunalLiving || 'N/A')}</p>
                                            <p className="text-sm md:text-base text-gray-700 mb-1 leading-tight"><span className="font-medium">Room Values:</span> {Array.isArray(profile.roomValues) ? profile.roomValues.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.roomValues || 'N/A')}</p>
                                            <p className="text-xs text-gray-500 mt-3 sm:mt-4">Created by: {profile.createdBy}</p>
                                            <p className="text-xs text-gray-500">On: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                                            <button
                                                onClick={() => handleDeleteProfile(profile.isLegacy ? 'wgProfiles' : 'roomProfiles', profile.id, profile.name, profile.createdBy)}
                                                className="mt-4 sm:mt-6 px-4 py-1.5 sm:px-5 sm:py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out self-end flex items-center transform hover:-translate-y-0.5 text-sm"
                                            >
                                                <Trash2 size={14} className="mr-1.5" /> Delete
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    // NORMAL USER MODE
                    <div className="w-full max-w-6xl flex flex-col gap-8 sm:gap-12">
                        {currentView === 'home' ? (
                            <>
                                {/* Form Selection Buttons / Login Prompt */}
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
                                            <Search size={20} className="mr-2" /> Seeker Profile
                                        </button>
                                        <button
                                            onClick={() => setShowSeekerForm(false)}
                                            className={`flex items-center justify-center px-6 py-3 sm:px-8 sm:py-4 rounded-xl text-lg sm:text-xl font-semibold shadow-xl transition-all duration-300 transform hover:scale-105 hover:shadow-2xl ${
                                                !showSeekerForm
                                                    ? 'bg-[#fecd82] text-[#333333]'
                                                    : 'bg-white text-[#fecd82] hover:bg-gray-50'
                                            }`}
                                        >
                                            <HomeIcon size={20} className="mr-2" /> Room Offer
                                        </button>
                                    </div>
                                ) : (
                                    <div className="w-full max-w-xl bg-white p-6 sm:p-8 rounded-2xl shadow-xl text-center text-gray-600 mb-8 sm:mb-12 mx-auto">
                                        <p className="text-base sm:text-lg">Please log in to create profiles and see matches.</p>
                                        <button
                                            onClick={handleGoogleSignIn}
                                            className="mt-4 sm:mt-6 px-5 py-2 sm:px-6 sm:py-3 bg-[#3fd5c1] text-white font-bold rounded-xl shadow-lg hover:bg-[#32c0ae] transition duration-150 ease-in-out transform hover:-translate-y-0.5 text-base"
                                        >
                                            <span className="flex items-center"><LogIn size={18} className="mr-2" /> Sign in with Google</span>
                                        </button>
                                    </div>
                                )}

                                {/* Current Form */}
                                {userId && (
                                    <div className="w-full max-w-xl mb-8 sm:mb-12 mx-auto">
                                        <ProfileForm onSubmit={showSeekerForm ? addSearcherProfile : addRoomProfile} type={showSeekerForm ? "seeker" : "provider"} key={showSeekerForm ? "seekerForm" : "providerForm"} />
                                    </div>
                                )}

                                {/* User Dashboards (if profiles exist AND user is logged in) */}
                                {(showMySeekerDashboard || showMyRoomDashboard) && userId ? (
                                    <div className="flex flex-col gap-8 sm:gap-12 w-full">
                                        {mySearcherProfiles.length > 0 && (
                                            <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-8 sm:mb-12">
                                                <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">My Seeker Profiles & Matches</h2>
                                                {mySearcherProfiles.map(profile => {
                                                    const profileMatches = matches.find(m => m.searcher.id === profile.id);
                                                    return (
                                                        <div key={profile.id} id={`profile-${profile.id}`} className="bg-[#f0f8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl mb-6 sm:mb-8">
                                                            {/* Own Seeker Profile Details */}
                                                            <h3 className="font-bold text-[#333333] text-base md:text-lg mb-3 sm:mb-4 flex items-center">
                                                                <Search size={20} className="mr-2 sm:mr-3 text-[#5a9c68]" /> Your Profile: <span className="font-extrabold ml-1 sm:ml-2">{profile.name}</span>
                                                            </h3>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Age:</span> {profile.age}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Gender:</span> {capitalizeFirstLetter(profile.gender)}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Max. Rent:</span> {profile.maxRent}€</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Pets:</span> {capitalizeFirstLetter(profile.pets === 'yes' ? 'Yes' : 'No')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Interests:</span> {Array.isArray(profile.interests) ? profile.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.interests || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Personality:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.personalityTraits || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Communal Living:</span> {Array.isArray(profile.communalLivingPreferences) ? profile.communalLivingPreferences.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.communalLivingPreferences || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-1 leading-tight"><span className="font-medium">Values:</span> {Array.isArray(profile.values) ? profile.values.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.values || 'N/A')}</p>
                                                            <button
                                                                onClick={() => handleDeleteProfile('searcherProfiles', profile.id, profile.name, profile.createdBy)}
                                                                className="mt-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out flex items-center text-sm"
                                                            >
                                                                <Trash2 size={14} className="mr-1.5" /> Delete Profile
                                                            </button>

                                                            {/* Matches for this specific Seeker Profile */}
                                                            <h4 className="text-lg sm:text-xl font-bold text-[#5a9c68] mt-6 sm:mt-8 mb-3 sm:mb-4 flex items-center">
                                                                <Heart size={18} className="mr-1 sm:mr-2" /> Matching Room Offers for {profile.name}:
                                                            </h4>
                                                            <div className="space-y-2">
                                                                {profileMatches && profileMatches.matchingRooms.length > 0 ? (
                                                                    profileMatches.matchingRooms.map(roomMatch => (
                                                                        <div key={roomMatch.room.id} className="bg-white p-4 sm:p-5 rounded-lg shadow border border-[#9adfaa] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                                            <div>
                                                                                <p className="font-bold text-gray-800 text-base md:text-lg">Room Name: {roomMatch.room.name}</p>
                                                                                <div className="flex items-center mt-1 sm:mt-2">
                                                                                    <div className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold inline-block ${getScoreColorClass(roomMatch.score)}`}>
                                                                                        Score: {roomMatch.score.toFixed(0)}
                                                                                    </div>
                                                                                    <button
                                                                                        onClick={() => setSelectedMatchDetails({ seeker: profile, room: roomMatch.room, matchDetails: roomMatch.fullMatchResult })}
                                                                                        className="ml-2 sm:ml-3 p-2 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition min-w-[44px] min-h-[44px] flex items-center justify-center"
                                                                                        title="Show Match Details"
                                                                                    >
                                                                                        <Info size={16} />
                                                                                    </button>
                                                                                    {userId && roomMatch.room.createdBy !== userId && ( // Don't show chat with self
                                                                                        <button
                                                                                            onClick={(e) => {
                                                                                                console.log("App: onClick fired for Seeker Matches chat button.");
                                                                                                handleStartChat(roomMatch.room.createdBy, roomMatch.room.id, roomMatch.room.name, 'room');
                                                                                            }}
                                                                                            onTouchEnd={(e) => {
                                                                                                e.preventDefault(); // Prevent default to avoid double-firing if onClick is also triggered
                                                                                                console.log("App: onTouchEnd fired for Seeker Matches chat button.");
                                                                                                handleStartChat(roomMatch.room.createdBy, roomMatch.room.id, roomMatch.room.name, 'room');
                                                                                            }}
                                                                                            className="ml-2 sm:ml-3 p-2 rounded-full bg-[#9adfaa] text-white hover:bg-[#85c292] transition min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
                                                                                            title="Start chat with Room Creator"
                                                                                        >
                                                                                            <MessageSquareText size={16} />
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                                <p className="text-sm md:text-base text-gray-600 mt-1 mb-0.5 leading-tight"><span className="font-medium">Desired Age:</span> {roomMatch.room.minAge}-{roomMatch.room.maxAge}, <span className="font-medium">Gender Preference:</span> {capitalizeFirstLetter(roomMatch.room.genderPreference)}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Rent:</span> {roomMatch.room.rent}€, <span className="font-medium">Room Type:</span> {capitalizeFirstLetter(roomMatch.room.roomType)}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Pets Allowed:</span> {capitalizeFirstLetter(roomMatch.room.petsAllowed === 'yes' ? 'Yes' : 'No')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Residents' Interests:</span> {Array.isArray(roomMatch.room.interests) ? roomMatch.room.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.interests || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Personality:</span> {Array.isArray(roomMatch.room.personalityTraits) ? roomMatch.room.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.personalityTraits || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Communal Living:</span> {Array.isArray(roomMatch.room.roomCommunalLiving) ? roomMatch.room.roomCommunalLiving.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomCommunalLiving || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-1 leading-tight"><span className="font-medium">Room Values:</span> {Array.isArray(roomMatch.room.roomValues) ? roomMatch.room.roomValues.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomValues || 'N/A')}</p>
                                                                            </div>
                                                                        </div>
                                                                    ))
                                                                ) : (
                                                                    <p className="text-gray-600 text-sm lg:text-base">No matching rooms for this profile.</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {myRoomProfiles.length > 0 && (
                                            <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-8 sm:mb-12">
                                                <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">My Room Offers & Matches</h2>
                                                {myRoomProfiles.map(profile => {
                                                    const profileMatches = reverseMatches.find(m => m.room.id === profile.id);
                                                    return (
                                                        <div key={profile.id} id={`profile-${profile.id}`} className="bg-[#fff8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#fecd82] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl mb-6 sm:mb-8">
                                                            {/* Own Room Profile Details */}
                                                            <h3 className="font-bold text-[#333333] text-base md:text-lg mb-3 sm:mb-4 flex items-center">
                                                                <HomeIcon size={20} className="mr-2 sm:mr-3 text-[#cc8a2f]" /> Your Room Profile: <span className="font-extrabold ml-1 sm:ml-2">{profile.name}</span>
                                                            </h3>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Rent:</span> {profile.rent}€</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Room Type:</span> {capitalizeFirstLetter(profile.roomType)}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Pets Allowed:</span> {capitalizeFirstLetter(profile.petsAllowed === 'yes' ? 'Yes' : 'No')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Average Age of Residents:</span> {profile.avgAge}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Residents' Interests:</span> {Array.isArray(profile.interests) ? profile.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.interests || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Personality:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.personalityTraits || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-medium">Communal Living:</span> {Array.isArray(profile.roomCommunalLiving) ? profile.roomCommunalLiving.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.roomCommunalLiving || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-700 mb-1 leading-tight"><span className="font-medium">Room Values:</span> {Array.isArray(profile.roomValues) ? profile.roomValues.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.roomValues || 'N/A')}</p>
                                                            <button
                                                                onClick={() => handleDeleteProfile(profile.isLegacy ? 'wgProfiles' : 'roomProfiles', profile.id, profile.name, profile.createdBy)}
                                                                className="mt-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out flex items-center text-sm"
                                                            >
                                                                <Trash2 size={14} className="mr-1.5" /> Delete Profile
                                                            </button>

                                                            {/* Matches for this specific Room Profile */}
                                                            <h4 className="text-lg sm:text-xl font-bold text-[#cc8a2f] mt-6 sm:mt-8 mb-3 sm:mb-4 flex items-center">
                                                                <Users size={18} className="mr-1 sm:mr-2" /> Matching Seekers for {profile.name}:
                                                            </h4>
                                                            <div className="space-y-2">
                                                                {profileMatches && profileMatches.matchingSeekers.length > 0 ? (
                                                                    profileMatches.matchingSeekers.map(seekerMatch => (
                                                                        <div key={seekerMatch.searcher.id} className="bg-white p-4 sm:p-5 rounded-lg shadow border border-[#fecd82] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                                            <div>
                                                                                <p className="font-bold text-gray-800 text-base md:text-lg">Seeker: {seekerMatch.searcher.name}</p>
                                                                                <div className="flex items-center mt-1 sm:mt-2">
                                                                                    <div className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold inline-block ${getScoreColorClass(seekerMatch.score)}`}>
                                                                                        Score: {seekerMatch.score.toFixed(0)}
                                                                                    </div>
                                                                                    <button
                                                                                        onClick={() => setSelectedMatchDetails({ seeker: seekerMatch.searcher, room: profile, matchDetails: seekerMatch.fullMatchResult })}
                                                                                        className="ml-2 sm:ml-3 p-2 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition min-w-[44px] min-h-[44px] flex items-center justify-center"
                                                                                        title="Show Match Details"
                                                                                    >
                                                                                        <Info size={16} />
                                                                                    </button>
                                                                                    {userId && seekerMatch.searcher.createdBy !== userId && ( // Don't show chat with self
                                                                                        <button
                                                                                            onClick={(e) => {
                                                                                                console.log("App: onClick fired for Room Matches chat button.");
                                                                                                handleStartChat(seekerMatch.searcher.createdBy, seekerMatch.searcher.id, seekerMatch.searcher.name, 'seeker');
                                                                                            }}
                                                                                            onTouchEnd={(e) => {
                                                                                                e.preventDefault(); // Prevent default to avoid double-firing if onClick is also triggered
                                                                                                console.log("App: onTouchEnd fired for Room Matches chat button.");
                                                                                                handleStartChat(seekerMatch.searcher.createdBy, seekerMatch.searcher.id, seekerMatch.searcher.name, 'seeker');
                                                                                            }}
                                                                                            className="ml-2 sm:ml-3 p-2 rounded-full bg-[#fecd82] text-white hover:bg-[#e6b772] transition min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
                                                                                            title="Start chat with Seeker"
                                                                                        >
                                                                                            <MessageSquareText size={16} />
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                                <p className="text-sm md:text-base text-gray-600 mt-1 mb-0.5 leading-tight"><span className="font-medium">Age:</span> {seekerMatch.searcher.age}, <span className="font-medium">Gender:</span> {capitalizeFirstLetter(seekerMatch.searcher.gender)}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Interests:</span> {Array.isArray(seekerMatch.searcher.interests) ? seekerMatch.searcher.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.interests || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Personality:</span> {Array.isArray(seekerMatch.searcher.personalityTraits) ? seekerMatch.searcher.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.personalityTraits || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Room Preferences:</span> {Array.isArray(seekerMatch.searcher.communalLivingPreferences) ? seekerMatch.searcher.communalLivingPreferences.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.communalLivingPreferences || 'N/A')}</p>
                                                                                <p className="text-sm md:text-base text-gray-600 mb-1 leading-tight"><span className="font-medium">Values:</span> {Array.isArray(seekerMatch.searcher.values) ? seekerMatch.searcher.values.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.values || 'N/A')}</p>
                                                                            </div>
                                                                        </div>
                                                                    ))
                                                                ) : (
                                                                    <p className="text-center text-gray-600 text-sm lg:text-base">No matching seekers for this room profile.</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    // If no profiles exist for the user, display a message
                                    userId && (
                                        <div className="w-full max-w-xl bg-white p-6 sm:p-8 rounded-2xl shadow-xl text-center text-gray-600 mb-8 sm:mb-12 mx-auto">
                                            <p className="text-base sm:text-lg">Create a profile to see your matches!</p>
                                        </div>
                                    )
                                )}
                            </>
                        ) : (
                            // Render ChatPage if currentView is 'chats'
                            <ChatPage
                                db={db}
                                currentUserUid={userId}
                                currentUserName={userName}
                                allSearcherProfilesGlobal={allSearcherProfilesGlobal}
                                allRoomProfilesGlobal={allRoomProfilesGlobal}
                                initialChatTargetUid={initialChatTargetUid}
                                setInitialChatTargetUid={setInitialChatTargetUid} // Pass the setter
                                initialChatTargetProfileId={initialChatTargetProfileId} // New
                                setInitialChatTargetProfileId={setInitialChatTargetProfileId} // New
                                initialChatTargetProfileName={initialChatTargetProfileName} // New
                                setInitialChatTargetProfileName={setInitialChatTargetProfileName} // New
                                initialChatTargetProfileType={initialChatTargetProfileType} // New
                                setInitialChatTargetProfileType={setInitialChatTargetProfileType} // New
                                allUserDisplayNamesMap={allUserDisplayNamesMap} // Pass allUserDisplayNamesMap
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