import React, { useState, useEffect, useCallback, useRef } from 'react'; // Added useRef
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc } from 'firebase/firestore';
import { Search, Users, Heart, Trash2, User, Home as HomeIcon, CheckCircle, XCircle, Info, LogIn, LogOut, Copy } from 'lucide-react';

// Firebase Configuration (provided by the user)
const firebaseConfig = {
    apiKey: "AIzaSyACGoSxD0_UZhWg06gzZjaifBn3sI06YGg", // <--- API KEY INSERTED HERE!
    authDomain: "mvp-roomatch.firebaseapp.com",
    projectId: "mvp-roomatch",
    storageBucket: "mvp-roomatch.firebasestorage.app",
    messagingSenderId: "190918526277",
    appId: "1:190918526277:web:268e07e2f1f326b8e86a2c",
    measurementId: "G-5JPWLD0ZC"
};

// Predefined lists for personality traits and interests
const allPersonalityTraits = ['tidy', 'calm', 'social', 'creative', 'sporty', 'night owl', 'early bird', 'tolerant', 'animal lover', 'flexible', 'structured'];
const allInterests = ['Cooking', 'Movies', 'Music', 'Games', 'Nature', 'Sports', 'Reading', 'Travel', 'Partying', 'Gaming', 'Plants', 'Culture', 'Art'];
const allCommunalLivingPreferences = ['very tidy', 'rather relaxed', 'prefers weekly cleaning schedules', 'spontaneous tidying', 'often cook together', 'sometimes cook together', 'rarely cook together'];
const allWGValues = ['sustainability important', 'open communication preferred', 'respect for privacy', 'shared activities important', 'prefers quiet home', 'prefers lively home', 'politically engaged', 'culturally interested'];

// Define fixed weights for matching criteria
const MATCH_WEIGHTS = {
    ageMatch: 2.0,           // Age is twice as important
    genderMatch: 1.0,        // Gender is normally important
    personalityTraits: 1.5,  // Personality traits are 1.5 times as important
    interests: 0.5,          // Interests are half as important
    rentMatch: 2.5,          // Rent is 2.5 times as important
    petsMatch: 1.2,          // Pets are slightly more important
    freeTextMatch: 0.2,      // Free text has minor importance
    avgAgeDifference: 1.0,   // Age difference (negative contribution)
    communalLiving: 1.8,     // Communal living preferences are important
    values: 2.0              // Values are twice as important
};

// **IMPORTANT:** REPLACE THIS VALUE EXACTLY WITH YOUR ACTUAL ADMIN UID, WHICH WILL BE SHOWN IN THE APP AFTER SUCCESSFUL GOOGLE LOGIN!
const ADMIN_UID = "hFt4BLSEg0UYAAUSfdf404mfw5v2"; // Placeholder: Please enter your Admin ID here!

// Helper to safely parse numbers
const safeParseInt = (value) => parseInt(value) || 0;

// Helper to capitalize first letter for display
const capitalizeFirstLetter = (string) => {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
};

// Function to calculate the match score between a seeker and a Room profile
// Now returns an object with total score and a detailed breakdown
const calculateMatchScore = (seeker, room) => {
    let totalScore = 0;
    // Initialize details with all possible categories and default values
    const details = {
        ageMatch: { score: 0, description: `Age match (N/A)` },
        genderMatch: { score: 0, description: `Gender preference (N/A)` },
        personalityTraits: { score: 0, description: `Personality overlap (None)` },
        interests: { score: 0, description: `Interests overlap (None)` },
        rentMatch: { score: 0, description: `Rent match (N/A)` },
        petsMatch: { score: 0, description: `Pets compatibility (N/A)` },
        freeTextMatch: { score: 0, description: `Free text keywords (None)` },
        avgAgeDifference: { score: 0, description: `Average age difference (N/A)` },
        communalLiving: { score: 0, description: `Communal living preferences (None)` },
        values: { score: 0, description: `Shared values (None)` },
    };

    const getArrayValue = (profile, field) => {
        const value = profile[field];
        return Array.isArray(value) ? value : (value ? String(value).split(',').map(s => s.trim()) : []);
    };

    // 1. Age Match (Seeker age vs. Room age range)
    const seekerAge = safeParseInt(seeker.age);
    const roomMinAge = safeParseInt(room?.minAge);
    const roomMaxAge = safeParseInt(room?.maxAge);
    let ageScore = 0;
    let ageDescription = `Age match (Seeker: ${seeker.age || 'N/A'}, Room: ${room?.minAge || 'N/A'}-${room?.maxAge || 'N/A'})`;

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
    let genderDescription = `Gender preference (Seeker: ${capitalizeFirstLetter(seeker.gender || 'N/A')}, Room: ${capitalizeFirstLetter(room?.genderPreference || 'N/A')})`;
    if (seeker.gender && room?.genderPreference) {
        if (room.genderPreference !== 'any' && seeker.gender !== room.genderPreference) {
            return { totalScore: -999999, details: { ...details, genderMatch: { score: -999999, description: "Gender mismatch (Disqualified)" } } };
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
    details.personalityTraits = { score: personalityScore, description: `Personality overlap (${commonTraits.map(capitalizeFirstLetter).join(', ') || 'None'})` };
    totalScore += personalityScore;

    // 4. Interests (Overlap)
    const seekerInterests = getArrayValue(seeker, 'interests');
    const roomInterests = getArrayValue(room, 'interests');
    const commonInterests = seekerInterests.filter(interest => roomInterests.includes(interest));
    let interestsScore = commonInterests.length * 3 * MATCH_WEIGHTS.interests;
    totalScore += interestsScore;
    details.interests = { score: interestsScore, description: `Interests overlap (${commonInterests.map(capitalizeFirstLetter).join(', ') || 'None'})` };

    // 5. Rent (Seeker Max Rent >= Room Rent)
    const seekerMaxRent = safeParseInt(seeker.maxRent);
    const roomRent = safeParseInt(room?.rent);
    let rentScore = 0;
    let rentDescription = `Rent match (Max: ${seeker.maxRent || 'N/A'}€, Room: ${room?.rent || 'N/A'}€)`;

    if (seekerMaxRent > 0 && roomRent > 0) {
        if (seekerMaxRent >= roomRent) {
            rentScore = 15 * MATCH_WEIGHTS.rentMatch;
        } else {
            rentScore = -(roomRent - seekerMaxRent) * MATCH_WEIGHTS.rentMatch * 0.2;
        }
    }
    details.rentMatch = { score: rentScore, description: rentDescription };
    totalScore += rentScore;

    // 6. Pets (Match)
    let petsScore = 0;
    let petsDescription = `Pets compatibility (Seeker: ${capitalizeFirstLetter(seeker.pets || 'N/A')}, Room: ${capitalizeFirstLetter(room?.petsAllowed || 'N/A')})`;
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

    // 7. Free text 'lookingFor' (seeker) vs. 'description'/'lookingForInFlatmate' (Room)
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
    details.freeTextMatch = { score: freeTextScore, description: `Free text keywords (${matchedKeywords.map(capitalizeFirstLetter).join(', ') || 'None'})` };
    
    // 8. Average age of Room residents compared to seeker's age
    const seekerAgeAvg = safeParseInt(seeker.age);
    const roomAvgAge = safeParseInt(room?.avgAge);
    let avgAgeDiffScore = 0;
    let avgAgeDescription = `Average age difference (Seeker: ${seeker.age || 'N/A'}, Room Avg: ${room?.avgAge || 'N/A'})`;
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
    details.communalLiving = { score: communalLivingScore, description: `Communal living preferences (${commonCommunalPrefs.map(capitalizeFirstLetter).join(', ') || 'None'})` };

    // 10. New: Values
    const seekerValues = getArrayValue(seeker, 'values');
    const roomValues = getArrayValue(room, 'roomValues');
    const commonValues = seekerValues.filter(val => roomValues.includes(val));
    let valuesScore = commonValues.length * 10 * MATCH_WEIGHTS.values;
    totalScore += valuesScore;
    details.values = { score: valuesScore, description: `Shared values (${commonValues.map(capitalizeFirstLetter).join(', ') || 'None'})` };

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

// Modal component to display match details
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

// Main component of the Room match application
function App() {
    const [mySearcherProfiles, setMySearcherProfiles] = useState([]);
    const [myRoomProfiles, setMyRoomProfiles] = useState([]);
    const [allSearcherProfilesGlobal, setAllSearcherProfilesGlobal] = useState([]);
    const [allRoomProfilesGlobal, setAllRoomProfilesGlobal] = useState([]);

    const [matches, setMatches] = useState([]);
    const [reverseMatches, setReverseMatches] = useState([]);
    
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null); // Firebase Auth Instance
    const [userId, setUserId] = useState(null);
    const [userName, setUserName] = useState(null); // State for user name
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showSeekerForm, setShowSeekerForm] = useState(true);
    const [saveMessage, setSaveMessage] = useState('');
    const [adminMode, setAdminMode] = useState(false);
    const [selectedMatchDetails, setSelectedMatchDetails] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false); // New state to track auth readiness
    const [showUserIdCopied, setShowUserIdCopied] = useState(false); // State for copy message

    const mainContentRef = useRef(null); // Ref for the main content area to scroll to

    // Firebase initialization and authentication
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
                    setUserName(user.displayName || user.email || 'Guest');
                    setAdminMode(user.uid === ADMIN_UID);
                } else {
                    // No user logged in. Wait for explicit Google login.
                    setUserId(null);
                    setUserName(null);
                    setAdminMode(false);
                }
                setIsAuthReady(true); // Auth system is ready, regardless of login status
                setLoading(false); // Loading finished
            });

            return () => {
                unsubscribeAuth();
            };
        } catch (initError) {
            console.error("Error during Firebase initialization:", initError);
            setError("Firebase could not be initialized. Please check your Firebase configuration and internet connection.");
            setLoading(false);
        }
    }, []);

    // Scroll to top of main content area after saving a profile
    useEffect(() => {
        if (saveMessage && mainContentRef.current) {
            // Adding a small delay to ensure rendering is complete before scrolling
            // or to allow the "save message" to be briefly visible.
            setTimeout(() => {
                mainContentRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300); // Small delay
        }
    }, [saveMessage]);

    // Function for Google Sign-in
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

    // Function for Sign-out
    const handleSignOut = async () => {
        if (!auth) {
            setError("Authentication service not ready for sign-out.");
            return;
        }
        try {
            await signOut(auth);
            setUserId(null);
            setUserName(null);
            setAdminMode(false);
            setError(null);
        } catch (error) {
            console.error("Sign-out error:", error);
            setError("Sign-out failed: " + error.message);
        }
    };

    // Function to copy UID to clipboard
    const copyUidToClipboard = () => {
        if (userId) {
            document.execCommand('copy'); // Using document.execCommand for iFrame compatibility
            // Fallback if the above doesn't work (e.g. not in user-gesture-driven context)
            const textArea = document.createElement("textarea");
            textArea.value = userId;
            textArea.style.position = "fixed"; // Avoid scrolling to bottom
            textArea.style.opacity = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                setShowUserIdCopied(true);
                setTimeout(() => setShowUserIdCopied(false), 2000);
            } catch (err) {
                console.error('Fallback: Oops, unable to copy', err);
                // In a real app, you might show a user-friendly message here instead of alert
            } finally {
                document.body.removeChild(textArea);
            }
        }
    };


    // When admin mode is toggled, ensure the form defaults back to 'Seeker Profile'
    useEffect(() => {
        if (!adminMode) {
            setShowSeekerForm(true);
        }
    }, [adminMode]);

    // Helper to get collection path (simplified for root-level collections as per rules)
    const getCollectionRef = useCallback((collectionName) => {
        if (!db) {
            console.warn("Attempted to get collection reference before Firestore DB was initialized.");
            return null;
        }
        return collection(db, collectionName);
    }, [db]);


    // Real-time data retrieval for *own* seeker profiles from Firestore
    useEffect(() => {
        // Fetch only if DB is ready, auth is ready, and a user is logged in
        if (!db || !userId || !isAuthReady) return;
        let unsubscribe;
        const timer = setTimeout(() => {
            const collectionRef = getCollectionRef(`searcherProfiles`);
            if (!collectionRef) {
                console.error("Collection reference for searcherProfiles is null after delay.");
                return;
            }
            const mySearchersQuery = query(collectionRef, where('createdBy', '==', userId));
            unsubscribe = onSnapshot(mySearchersQuery, (snapshot) => {
                const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setMySearcherProfiles(profiles);
            }, (err) => {
                console.error("Error fetching own seeker profiles:", err);
                setError("Error loading own seeker profiles.");
            });
        }, 100);

        return () => {
            clearTimeout(timer);
            if (unsubscribe) unsubscribe();
        };
    }, [db, userId, isAuthReady, getCollectionRef]);

    const [myNewRoomProfilesData, setMyNewRoomProfilesData] = useState([]); 
    const [myOldWgProfilesData, setMyOldWgProfilesData] = useState([]);

    // Real-time data retrieval for *own* Room profiles from Firestore
    useEffect(() => {
        // Fetch only if DB is ready, auth is ready, and a user is logged in
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
                    console.error("Error fetching own new Room profiles:", err);
                    setError("Error loading own Room profiles.");
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

    // Real-time data retrieval for *all* seeker profiles (for match calculation)
    useEffect(() => {
        // Fetch only if DB is ready, auth is ready, and a user is logged in (or admin mode)
        // If auth is not ready or user is not logged in, these listeners should not be active
        if (!db || !isAuthReady || (!userId && !adminMode)) {
            setAllSearcherProfilesGlobal([]); // Clear global profiles if not authorized to fetch
            return;
        }; 
        let unsubscribe;
        const timer = setTimeout(() => {
            const collectionRef = getCollectionRef(`searcherProfiles`);
            if (!collectionRef) {
                console.error("Collection reference for all searcherProfiles is null after delay.");
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

    // Real-time data retrieval for *all* Room profiles (for match calculation - combining new and old collections)
    useEffect(() => {
        // Fetch only if DB is ready, auth is ready, and a user is logged in (or admin mode)
        // If auth is not ready or user is not logged in, these listeners should not be active
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
                    console.error("Error fetching all Room profiles (new collection):", err);
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
                    console.error("Error fetching all Room profiles (old WG collection):", err);
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
            // Matches only calculated for logged-in users or in admin mode
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

        // Only calculate matches if DB is ready, auth is ready, AND user is logged in or in admin mode
        if (db && isAuthReady && (userId || adminMode)) {
            calculateAllMatches();
        } else {
            // Clear matches if not authorized to calculate/view them
            setMatches([]);
            setReverseMatches([]);
        }
    }, [mySearcherProfiles, myRoomProfiles, allSearcherProfilesGlobal, allRoomProfilesGlobal, loading, adminMode, userId, db, isAuthReady]);

    // Function to add a seeker profile to Firestore
    const addSearcherProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Database not ready or not logged in. Please wait or log in.");
            return;
        }
        try {
            const collectionRef = getCollectionRef(`searcherProfiles`);
            if (!collectionRef) {
                setError("Could not get collection reference for searcher profiles.");
                return;
            }
            await addDoc(collectionRef, {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId, // Link profile to USER_ID
            });
            setSaveMessage('Seeker profile saved successfully!');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e) {
            console.error("Error adding seeker profile: ", e);
            setError("Error saving seeker profile.");
        }
    };

    // Function to add a Room profile to Firestore
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
            await addDoc(collectionRef, {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId, // Link profile to USER_ID
            });
            setSaveMessage('Room profile saved successfully!');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e) {
            console.error("Error adding Room profile: ", e);
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
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e) {
            console.error(`Error deleting profile ${profileName}: `, e);
            setError(`Error deleting profile "${profileName}".`);
        }
    };

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
                                                Selecting "Male" or "Female" will exclude seekers of the other gender from your match results.
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

                        {/* Location / City District (for both) */}
                        <div>
                            <label className="block text-gray-700 text-sm sm:text-base font-semibold mb-1 sm:mb-2">Location / City District:</label>
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
                                {type === 'seeker' ? 'Your Communal Living Preferences:' : 'Room Communal Living Preferences:'}
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
                        {/* What is being sought (Seeker) / Description of the Room (Provider) */}
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
                                {type === 'seeker' ? 'Your Values and Expectations for Room Life:' : 'Room Values and Expectations:'}
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
                <p className="text-gray-700 text-lg animate-pulse">Loading App and Data...</p>
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
        <div className="min-h-screen bg-[#3fd5c1] p-4 sm:p-8 font-inter flex flex-col items-center relative overflow-hidden">
            {/* Background circles for visual dynamism */}
            <div className="absolute top-[-50px] left-[-50px] w-48 h-48 bg-white opacity-10 rounded-full animate-blob-slow"></div>
            <div className="absolute bottom-[-50px] right-[-50px] w-64 h-64 bg-white opacity-10 rounded-full animate-blob-medium"></div>
            <div className="absolute top-1/3 right-1/4 w-32 h-32 bg-white opacity-10 rounded-full animate-blob-fast"></div>

            <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 sm:mb-8 text-center drop-shadow-lg">Roomatch</h1>
            
            {/* User Info / Login / Logout */}
            <div className="bg-[#c3efe8] text-[#0a665a] text-xs sm:text-sm px-4 py-2 sm:px-6 sm:py-3 rounded-full mb-6 sm:mb-8 shadow-md flex flex-col sm:flex-row items-center transform transition-all duration-300 hover:scale-[1.02] text-center">
                {userId ? (
                    <>
                        <span className="mb-1 sm:mb-0 sm:mr-2 flex items-center">
                            <User size={16} className="mr-1" /> Logged in as: <span className="font-semibold ml-1">{userName}</span>
                        </span>
                        {/* Display User ID and Copy Button */}
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

            {saveMessage && (
                <div className="bg-green-100 text-green-700 px-4 py-2 sm:px-5 sm:py-3 rounded-lg mb-4 sm:mb-6 shadow-xl transition-all duration-300 scale-100 animate-fade-in-down text-sm sm:text-base">
                    {saveMessage}
                </div>
            )}

            {/* --- MAIN VIEWS (Admin Mode vs. Normal Mode) --- */}
            {adminMode ? (
                // ADMIN MODE ON: Show all admin dashboards
                <div ref={mainContentRef} className="w-full max-w-6xl flex flex-col gap-8 sm:gap-12"> {/* Added ref here */}
                    {/* Admin Matches: Seeker finds Room */}
                    <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                        <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">Matches: Seeker finds Room (Admin View)</h2>
                        {matches.length === 0 ? (
                            <p className="text-center text-gray-600 text-base sm:text-lg py-4">No matches found.</p>
                        ) : (
                            <div className="space-y-6 sm:space-y-8">
                                {matches.map((match, index) => (
                                    <div key={index} className="bg-[#f0f8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                        <h3 className="text-xl sm:text-2xl font-bold text-[#333333] mb-3 sm:mb-4 flex items-center">
                                            <Search size={20} className="mr-2 sm:mr-3 text-[#5a9c68]" /> Seeker: <span className="font-extrabold ml-1 sm:ml-2">{match.searcher.name}</span> <span className="text-sm font-normal text-gray-600 ml-1">(ID: {match.searcher.id.substring(0, 8)}...)</span>
                                        </h3>
                                        <h4 className="text-lg sm:text-xl font-bold text-[#5a9c68] mb-3 sm:mb-4 flex items-center">
                                            <Heart size={18} className="mr-1 sm:mr-2" /> Matching Room Offers:
                                        </h4>
                                        <div className="space-y-2">
                                            {match.matchingRooms.length === 0 ? (
                                                <p className="text-gray-600 text-sm lg:text-base">No matching rooms.</p>
                                            ) : (
                                                match.matchingRooms.map(roomMatch => (
                                                    <div key={roomMatch.room.id} className="bg-white p-4 sm:p-5 rounded-lg shadow border border-[#9adfaa] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                        <div>
                                                            <p className="font-bold text-gray-800 text-base md:text-lg">Room Name: {roomMatch.room.name}</p>
                                                            <div className="flex items-center mt-1 sm:mt-2">
                                                                <div className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold inline-block ${getScoreColorClass(roomMatch.score)}`}>
                                                                    Score: {roomMatch.score.toFixed(0)}
                                                                </div>
                                                                <button
                                                                    onClick={() => setSelectedMatchDetails({ seeker: match.searcher, room: roomMatch.room, matchDetails: roomMatch.fullMatchResult })}
                                                                    className="ml-2 sm:ml-3 p-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                                                                    title="Show Match Details"
                                                                >
                                                                    <Info size={16} />
                                                                </button>
                                                            </div>
                                                            <p className="text-sm md:text-base text-gray-600 mt-1 mb-0.5 leading-tight"><span className="font-medium">Desired Age:</span> {roomMatch.room.minAge}-{roomMatch.room.maxAge}, <span className="font-medium">Gender Preference:</span> {capitalizeFirstLetter(roomMatch.room.genderPreference)}</p>
                                                            <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Interests:</span> {Array.isArray(roomMatch.room.interests) ? roomMatch.room.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.interests || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Resident Personality:</span> {Array.isArray(roomMatch.room.personalityTraits) ? roomMatch.room.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.personalityTraits || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Communal Living:</span> {Array.isArray(roomMatch.room.roomCommunalLiving) ? roomMatch.room.roomCommunalLiving.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomCommunalLiving || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-600 mb-1 leading-tight"><span className="font-medium">Room Values:</span> {Array.isArray(roomMatch.room.roomValues) ? roomMatch.room.roomValues.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomValues || 'N/A')}</p>
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

                    {/* Admin Matches: Room finds Seeker */}
                    <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                        <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">Matches: Room finds Seeker (Admin View)</h2>
                        {reverseMatches.length === 0 ? (
                            <p className="text-center text-gray-600 text-base sm:text-lg py-4">No matches found.</p>
                        ) : (
                            <div className="space-y-6 sm:space-y-8">
                                {reverseMatches.map((roomMatch, index) => (
                                    <div key={index} className="bg-[#fff8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#fecd82] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                        <h3 className="text-xl sm:text-2xl font-bold text-[#333333] mb-3 sm:mb-4 flex items-center">
                                            <HomeIcon size={20} className="mr-2 sm:mr-3 text-[#cc8a2f]" /> Room Name: <span className="font-extrabold ml-1 sm:ml-2">{roomMatch.room.name}</span> <span className="text-sm font-normal text-gray-600 ml-1">(ID: {roomMatch.room.id.substring(0, 8)}...)</span>
                                        </h3>
                                        <h4 className="text-lg sm:text-xl font-bold text-[#cc8a2f] mt-6 sm:mt-8 mb-3 sm:mb-4 flex items-center">
                                            <Users size={18} className="mr-1 sm:mr-2" /> Matching Seekers:
                                        </h4>
                                        <div className="space-y-2">
                                            {roomMatch.matchingSeekers.length === 0 ? (
                                                <p className="text-gray-600 text-sm lg:text-base">No matching seekers for this room profile.</p>
                                            ) : (
                                                roomMatch.matchingSeekers.map(seekerMatch => (
                                                    <div key={seekerMatch.searcher.id} className="bg-white p-4 sm:p-5 rounded-lg shadow border border-[#fecd82] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                        <div>
                                                            <p className="font-bold text-gray-800 text-base md:text-lg">Seeker: {seekerMatch.searcher.name}</p>
                                                            <div className="flex items-center mt-1 sm:mt-2">
                                                                <div className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold inline-block ${getScoreColorClass(seekerMatch.score)}`}>
                                                                    Score: {seekerMatch.score.toFixed(0)}
                                                                </div>
                                                                <button
                                                                    onClick={() => setSelectedMatchDetails({ seeker: seekerMatch.searcher, room: roomMatch.room, matchDetails: seekerMatch.fullMatchResult })}
                                                                    className="ml-2 sm:ml-3 p-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                                                                    title="Show Match Details"
                                                                >
                                                                    <Info size={16} />
                                                                </button>
                                                            </div>
                                                            <p className="text-sm md:text-base text-gray-600 mt-1 mb-0.5 leading-tight"><span className="font-medium">Age:</span> {seekerMatch.searcher.age}, <span className="font-medium">Gender:</span> {capitalizeFirstLetter(seekerMatch.searcher.gender)}</p>
                                                            <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Interests:</span> {Array.isArray(seekerMatch.searcher.interests) ? seekerMatch.searcher.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.interests || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Personality:</span> {Array.isArray(seekerMatch.searcher.personalityTraits) ? seekerMatch.searcher.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.personalityTraits || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Room Preferences:</span> {Array.isArray(seekerMatch.searcher.communalLivingPreferences) ? seekerMatch.searcher.communalLivingPreferences.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.communalLivingPreferences || 'N/A')}</p>
                                                            <p className="text-sm md:text-base text-gray-600 mb-1 leading-tight"><span className="font-medium">Values:</span> {Array.isArray(seekerMatch.searcher.values) ? seekerMatch.searcher.values.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(seekerMatch.searcher.values || 'N/A')}</p>
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

                    {/* All Room Profiles (Admin View) */}
                    <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-8 sm:mb-12">
                        <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-6 sm:mb-8 text-center">All Room Offers (Admin View)</h2>
                        {allRoomProfilesGlobal.length === 0 ? (
                            <p className="text-center text-gray-600 text-base sm:text-lg py-4">No room offers available yet.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {allRoomProfilesGlobal.map(profile => (
                                    <div key={profile.id} className="bg-[#fff8f0] p-5 sm:p-6 rounded-xl shadow-lg border border-[#fecd82] flex flex-col transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                        <p className="font-bold text-[#333333] text-base md:text-lg mb-2">Room Name: {profile.name}</p>
                                        <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Desired Age:</span> {profile.minAge}-{profile.maxAge}</p>
                                        <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Gender Preference:</span> {capitalizeFirstLetter(profile.genderPreference)}</p>
                                        <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Interests:</span> {Array.isArray(profile.interests) ? profile.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.interests || 'N/A')}</p>
                                        <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Resident Personality:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.personalityTraits || 'N/A')}</p>
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
                // NORMAL MODE: Show form selection + forms and then dashboards (if available)
                <div ref={mainContentRef} className="w-full max-w-6xl flex flex-col gap-8 sm:gap-12"> {/* Added ref here */}
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
                            <p className="text-base sm:text-lg">Please sign in to create profiles and see matches.</p>
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
                                            <div key={profile.id} className="bg-[#f0f8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl mb-6 sm:mb-8">
                                                {/* Own Seeker Profile Details */}
                                                <h3 className="font-bold text-[#333333] text-base md:text-lg mb-3 sm:mb-4 flex items-center">
                                                    <Search size={20} className="mr-2 sm:mr-3 text-[#5a9c68]" /> Your Profile: <span className="font-extrabold ml-1 sm:ml-2">{profile.name}</span>
                                                </h3>
                                                <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Age:</span> {profile.age}</p>
                                                <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Gender:</span> {capitalizeFirstLetter(profile.gender)}</p>
                                                <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Max Rent:</span> {profile.maxRent}€</p>
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
                                                                            className="ml-2 sm:ml-3 p-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                                                                            title="Show Match Details"
                                                                        >
                                                                            <Info size={16} />
                                                                        </button>
                                                                    </div>
                                                                    <p className="text-sm md:text-base text-gray-600 mt-1 mb-0.5 leading-tight"><span className="font-medium">Desired Age:</span> {roomMatch.room.minAge}-{roomMatch.room.maxAge}, <span className="font-medium">Gender Preference:</span> {capitalizeFirstLetter(roomMatch.room.genderPreference)}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Interests:</span> {Array.isArray(roomMatch.room.interests) ? roomMatch.room.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.interests || 'N/A')}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Resident Personality:</span> {Array.isArray(roomMatch.room.personalityTraits) ? roomMatch.room.personalityTraits.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.personalityTraits || 'N/A')}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-0.5 leading-tight"><span className="font-medium">Communal Living:</span> {Array.isArray(roomMatch.room.roomCommunalLiving) ? roomMatch.room.roomCommunalLiving.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomCommunalLiving || 'N/A')}</p>
                                                                    <p className="text-sm md:text-base text-gray-600 mb-1 leading-tight"><span className="font-medium">Room Values:</span> {Array.isArray(roomMatch.room.roomValues) ? roomMatch.room.roomValues.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(roomMatch.room.roomValues || 'N/A')}</p>
                                                                </div>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <p className="text-gray-600 text-sm md:text-base">No matching rooms for this profile.</p>
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
                                            <div key={profile.id} className="bg-[#fff8f0] p-6 sm:p-8 rounded-xl shadow-lg border border-[#fecd82] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl mb-6 sm:mb-8">
                                                {/* Own Room Profile Details */}
                                                <h3 className="font-bold text-[#333333] text-base md:text-lg mb-3 sm:mb-4 flex items-center">
                                                    <HomeIcon size={20} className="mr-2 sm:mr-3 text-[#cc8a2f]" /> Your Room Profile: <span className="font-extrabold ml-1 sm:ml-2">{profile.name}</span>
                                                </h3>
                                                <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Rent:</span> {profile.rent}€</p>
                                                <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Room Type:</span> {capitalizeFirstLetter(profile.roomType)}</p>
                                                <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Pets Allowed:</span> {capitalizeFirstLetter(profile.petsAllowed === 'yes' ? 'Yes' : 'No')}</p>
                                                <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Average Age Residents:</span> {profile.avgAge}</p>
                                                <p className="text-sm md:text-base text-gray-700 mb-0.5 leading-tight"><span className="font-semibold">Resident Interests:</span> {Array.isArray(profile.interests) ? profile.interests.map(capitalizeFirstLetter).join(', ') : capitalizeFirstLetter(profile.interests || 'N/A')}</p>
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
                                                                            className="ml-2 sm:ml-3 p-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                                                                            title="Show Match Details"
                                                                        >
                                                                            <Info size={16} />
                                                                        </button>
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
                                                        <p className="text-gray-600 text-sm md:text-base">No matching seekers for this profile.</p>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ) : (
                        // If no profiles and user is logged in, no dashboard should be rendered,
                        // just the form for creating profiles. This 'else' block ensures nothing extra is rendered.
                        null
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
    );
}

export default App;