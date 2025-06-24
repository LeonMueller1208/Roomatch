import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc } from 'firebase/firestore';
import { Search, Users, Heart, Trash2, User, Home as HomeIcon, CheckCircle, XCircle } from 'lucide-react';

// Firebase Configuration
const firebaseConfig = {
    // REPLACE THIS API KEY WITH YOUR OWN FROM THE FIREBASE CONSOLE!
    apiKey: "AIzaSyACGoSxD0_UZhWg06gzZjaifBn3sI06YGg", // Example: "AIzaSyACGoSxD0_UZWNg06gzZjaifBn3sI06YGg"
    authDomain: "mvp-roomatch.firebaseapp.com",
    projectId: "mvp-roomatch",
    storageBucket: "mvp-roomatch.firebasestorage.app",
    messagingSenderId: "190918526277",
    appId: "1:190918526277:web:268e07e2f1f326b8e86a2c",
    measurementId: "G-5JPWLD0ZC"
};

// Predefined lists for personality traits and interests
const allPersonalityTraits = ['tidy', 'calm', 'social', 'creative', 'sporty', 'night owl', 'early bird', 'tolerant', 'animal lover', 'flexible', 'structured'];
const allInterests = ['Cooking', 'Movies', 'Music', 'Games', 'Natur', 'Sports', 'Reading', 'Travel', 'Partying', 'Gaming', 'Plants', 'Culture', 'Art'];
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


// **IMPORTANT:** REPLACE THIS VALUE EXACTLY WITH YOUR ADMIN ID SHOWN IN THE APP!
const ADMIN_UID = "H9jtz5aHKkcN7JCjtTPL7t32rtE3"; 

// Function to calculate the match score between a seeker and a WG profile
const calculateMatchScore = (seeker, wg) => {
    let score = 0;

    const getArrayValue = (profile, field) => {
        const value = profile[field];
        return Array.isArray(value) ? value : (value ? String(value).split(',').map(s => s.trim()) : []);
    };

    // 1. Age Match (Seeker age vs. WG age range)
    if (seeker.age && wg.minAge && wg.maxAge) {
        if (seeker.age >= wg.minAge && seeker.age <= wg.maxAge) {
            score += 20 * MATCH_WEIGHTS.ageMatch;
        } else {
            // Penalize if age is outside the preferred range
            const ageDiffLow = Math.max(0, wg.minAge - seeker.age);
            const ageDiffHigh = Math.max(0, seeker.age - wg.maxAge);
            score -= (ageDiffLow + ageDiffHigh) * MATCH_WEIGHTS.ageMatch * 0.5; // Half penalty for being outside range
        }
    }

    // 2. Gender Preference
    if (seeker.gender && wg.genderPreference) {
        if (wg.genderPreference === 'any' || seeker.gender === wg.genderPreference) {
            score += 10 * MATCH_WEIGHTS.genderMatch;
        } else {
            score -= 10 * MATCH_WEIGHTS.genderMatch;
        }
    }

    // 3. Personality Traits (Overlap)
    const seekerTraits = getArrayValue(seeker, 'personalityTraits');
    const wgTraits = getArrayValue(wg, 'personalityTraits');
    seekerTraits.forEach(trait => {
        if (wgTraits.includes(trait)) {
            score += 5 * MATCH_WEIGHTS.personalityTraits;
        }
    });

    // 4. Interests (Overlap)
    const seekerInterests = getArrayValue(seeker, 'interests');
    const wgInterests = getArrayValue(wg, 'interests');
    seekerInterests.forEach(interest => {
        if (wgInterests.includes(interest)) {
            score += 3 * MATCH_WEIGHTS.interests;
        }
    });

    // 5. Rent (Seeker Max Rent >= WG Rent)
    if (seeker.maxRent && wg.rent) {
        if (seeker.maxRent >= wg.rent) {
            score += 15 * MATCH_WEIGHTS.rentMatch;
        } else {
            // Strong penalty if seeker's max rent is less than WG's rent
            score -= (wg.rent - seeker.maxRent) * MATCH_WEIGHTS.rentMatch * 0.2; 
        }
    }

    // 6. Pets (Match)
    if (seeker.pets && wg.petsAllowed) {
        if (seeker.pets === 'yes' && wg.petsAllowed === 'yes') {
            score += 8 * MATCH_WEIGHTS.petsMatch;
        } else if (seeker.pets === 'yes' && wg.petsAllowed === 'no') {
            score -= 20 * MATCH_WEIGHTS.petsMatch; // Strong penalty if seeker has pets but WG doesn't allow
        } else if (seeker.pets === 'no' && wg.petsAllowed === 'yes') {
            // No penalty if seeker doesn't have pets but WG allows (it's optional)
        } else if (seeker.pets === 'no' && wg.petsAllowed === 'no') {
            score += 5 * MATCH_WEIGHTS.petsMatch; // Positive if both explicitly don't want pets
        }
    }

    // 7. Free text 'lookingFor' (seeker) vs. 'description'/'lookingForInFlatmate' (WG)
    const seekerLookingFor = (seeker.lookingFor || '').toLowerCase();
    const wgDescription = (wg.description || '').toLowerCase();
    const wgLookingForInFlatmate = (wg.lookingForInFlatmate || '').toLowerCase();

    const seekerKeywords = seekerLookingFor.split(' ').filter(word => word.length > 2);
    seekerKeywords.forEach(keyword => {
        if (wgDescription.includes(keyword) || wgLookingForInFlatmate.includes(keyword)) {
            score += 1 * MATCH_WEIGHTS.freeTextMatch;
        }
    });

    // 8. Average age of WG residents compared to seeker's age
    if (seeker.age && wg.avgAge) {
        score -= Math.abs(seeker.age - wg.avgAge) * MATCH_WEIGHTS.avgAgeDifference;
    }

    // 9. New: Communal Living Preferences
    const seekerCommunalPrefs = getArrayValue(seeker, 'communalLivingPreferences');
    const wgCommunalPrefs = getArrayValue(wg, 'wgCommunalLiving');
    seekerCommunalPrefs.forEach(pref => {
        if (wgCommunalPrefs.includes(pref)) {
            score += 7 * MATCH_WEIGHTS.communalLiving; // High value for lifestyle agreement
        }
    });

    // 10. New: Values
    const seekerValues = getArrayValue(seeker, 'values');
    const wgValues = getArrayValue(wg, 'wgValues');
    seekerValues.forEach(val => {
        if (wgValues.includes(val)) {
            score += 10 * MATCH_WEIGHTS.values; // Very high value for value agreement
        }
    });

    return score;
};

// Helper function to get color class based on score
const getScoreColorClass = (score) => {
    if (score >= 100) { // Very good match
        return 'bg-green-200 text-green-800';
    } else if (score >= 50) { // Good match
        return 'bg-yellow-200 text-yellow-800';
    } else if (score >= 0) { // Neutral/okay match
        return 'bg-orange-200 text-orange-800';
    } else { // Poor match
        return 'bg-red-200 text-red-800';
    }
};

// Main component of the WG match application
function App() {
    const [mySearcherProfiles, setMySearcherProfiles] = useState([]);
    const [myWgProfiles, setMyWgProfiles] = useState([]);
    const [allSearcherProfilesGlobal, setAllSearcherProfilesGlobal] = useState([]);
    const [allWgProfilesGlobal, setAllWgProfilesGlobal] = useState([]);
    const [matches, setMatches] = useState([]);
    const [reverseMatches, setReverseMatches] = useState([]);
    
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showSeekerForm, setShowSeekerForm] = useState(true); // Display seeker form by default
    const [saveMessage, setSaveMessage] = useState('');
    const [adminMode, setAdminMode] = useState(false);

    // Firebase initialization and authentication
    useEffect(() => {
        let appInstance, dbInstance, authInstance;

        try {
            appInstance = initializeApp(firebaseConfig);
            dbInstance = getFirestore(appInstance);
            authInstance = getAuth(appInstance);

            setDb(dbInstance);

            const unsubscribeAuth = onAuthStateChanged(authInstance, async (user) => {
                if (!user) {
                    try {
                        await signInAnonymously(authInstance);
                    } catch (signInError) {
                        console.error("Error during Firebase anonymous authentication:", signInError);
                        setError("Error signing in. Please try again later.");
                        setLoading(false);
                        return;
                    }
                }
                const currentUid = authInstance.currentUser?.uid || 'anonymous-' + Date.now() + '-' + Math.random().toString(36).substring(2);
                setUserId(currentUid);
                setAdminMode(currentUid === ADMIN_UID); 
                setLoading(false);
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

    // When admin mode is toggled, ensure the form defaults back to 'Seeker Profile'
    useEffect(() => {
        if (!adminMode) {
            setShowSeekerForm(true); // Sets it to seeker form when admin mode is deactivated
        }
    }, [adminMode]);


    // Real-time data retrieval for *own* seeker profiles from Firestore
    useEffect(() => {
        if (!db || !userId) return;
        // Updated path for public data if you change Firestore security rules to "public".
        // If you want to store private data by user ID, the path would be `users/${userId}/searcherProfiles`
        const mySearchersQuery = query(collection(db, `searcherProfiles`), where('createdBy', '==', userId));
        const unsubscribeMySearchers = onSnapshot(mySearchersQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMySearcherProfiles(profiles);
        }, (err) => {
            console.error("Error fetching own seeker profiles:", err);
            setError("Error loading own seeker profiles.");
        });
        return () => unsubscribeMySearchers();
    }, [db, userId]);

    // Real-time data retrieval for *own* WG profiles from Firestore
    useEffect(() => {
        if (!db || !userId) return;
        const myWgsQuery = query(collection(db, `wgProfiles`), where('createdBy', '==', userId));
        const unsubscribeMyWGs = onSnapshot(myWgsQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMyWgProfiles(profiles);
        }, (err) => {
            console.error("Error fetching own WG profiles:", err);
            setError("Error loading own WG profiles.");
        });
        return () => unsubscribeMyWGs();
    }, [db, userId]);

    // Real-time data retrieval for *all* seeker profiles (for match calculation)
    useEffect(() => {
        if (!db) return;
        const allSearchersQuery = query(collection(db, `searcherProfiles`));
        const unsubscribeAllSearchers = onSnapshot(allSearchersQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAllSearcherProfilesGlobal(profiles);
        }, (err) => {
            console.error("Error fetching all seeker profiles (global):", err);
        });
        return () => unsubscribeAllSearchers();
    }, [db]);

    // Real-time data retrieval for *all* WG profiles (for match calculation)
    useEffect(() => {
        if (!db) return;
        const allWgsQuery = query(collection(db, `wgProfiles`));
        const unsubscribeAllWGs = onSnapshot(allWgsQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAllWgProfilesGlobal(profiles);
        }, (err) => {
            console.error("Error fetching all WG profiles (global):", err);
        });
        return () => unsubscribeAllWGs();
    }, [db]);

    // Match calculation for both directions
    useEffect(() => {
        const calculateAllMatches = () => {
            const newSeekerToWGMatches = [];
            const seekersForMatching = adminMode ? allSearcherProfilesGlobal : mySearcherProfiles;
            
            seekersForMatching.forEach(searcher => {
                const matchingWGs = allWgProfilesGlobal.map(wg => {
                    const score = calculateMatchScore(searcher, wg);
                    return { wg, score };
                });
                matchingWGs.sort((a, b) => b.score - a.score);
                newSeekerToWGMatches.push({ searcher: searcher, matchingWGs: matchingWGs });
            });
            setMatches(newSeekerToWGMatches);

            const newWGToSeekerMatches = [];
            const wgsForMatching = adminMode ? allWgProfilesGlobal : myWgProfiles;

            wgsForMatching.forEach(wg => {
                const matchingSeekers = allSearcherProfilesGlobal.map(searcher => {
                    const score = calculateMatchScore(searcher, wg);
                    return { searcher, score };
                });
                matchingSeekers.sort((a, b) => b.score - a.score);
                newWGToSeekerMatches.push({ wg: wg, matchingSeekers: matchingSeekers });
            });
            setReverseMatches(newWGToSeekerMatches);
        };

        if (!loading && db && userId) {
            calculateAllMatches();
        } else if (mySearcherProfiles.length === 0 && myWgProfiles.length === 0 && !loading) {
            setMatches([]);
            setReverseMatches([]);
        }
    }, [mySearcherProfiles, myWgProfiles, allSearcherProfilesGlobal, allWgProfilesGlobal, loading, adminMode, userId, db]);


    // Function to add a seeker profile to Firestore
    const addSearcherProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Database not ready. Please wait or log in.");
            return;
        }
        try {
            await addDoc(collection(db, `searcherProfiles`), {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId,
            });
            setSaveMessage('Seeker profile successfully saved!');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e) {
            console.error("Error adding seeker profile: ", e);
            setError("Error saving seeker profile.");
        }
    };

    // Function to add a WG profile to Firestore
    const addWGProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Database not ready. Please wait or log in.");
            return;
        }
        try {
            await addDoc(collection(db, `wgProfiles`), {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId,
            });
            setSaveMessage('WG profile successfully saved!');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e) {
            console.error("Error adding WG profile: ", e);
            setError("Error saving WG profile.");
        }
    };

    // Function to delete a profile
    const handleDeleteProfile = async (collectionName, docId, profileName, profileCreatorId) => {
        if (!db || !userId) {
            setError("Database not ready for deletion.");
            return;
        }

        // Check permission before deletion
        if (!adminMode && userId !== profileCreatorId) {
            setError("You are not authorized to delete this profile.");
            setTimeout(() => setError(''), 3000); // Hide message after 3 seconds
            return;
        }

        // Direct deletion without confirmation dialog
        try {
            await deleteDoc(doc(db, collectionName, docId));
            setSaveMessage(`Profile "${profileName}" successfully deleted!`);
            setTimeout(() => setSaveMessage(''), 3000); // Hide message after 3 seconds
        } catch (e) {
            console.error(`Error deleting profile ${profileName}: `, e);
            setError(`Error deleting profile "${profileName}".`);
        }
    };

    // Unified Profile Form Component
    const ProfileForm = ({ onSubmit, type }) => {
        const [currentStep, setCurrentStep] = useState(1);
        const totalSteps = 3; // Number of steps defined here

        const [formState, setFormState] = useState({
            name: '',
            age: '', minAge: '', maxAge: '',
            gender: 'male', genderPreference: 'any',
            personalityTraits: [],
            interests: [],
            maxRent: '', pets: 'any', lookingFor: '',
            description: '', rent: '', roomType: 'Single Room', petsAllowed: 'any',
            avgAge: '', lookingForInFlatmate: '',
            location: '',
            communalLivingPreferences: [], // New for seekers
            wgCommunalLiving: [],          // New for providers
            values: [],                    // New for seekers
            wgValues: [],                  // New for providers
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
            console.log(`nextStep called: currentStep was ${currentStep}`);
            setCurrentStep((prev) => {
                const newStep = Math.min(prev + 1, totalSteps);
                console.log(`nextStep: currentStep becomes ${newStep}`);
                return newStep;
            });
        };

        const prevStep = () => {
            console.log(`prevStep called: currentStep was ${currentStep}`);
            setCurrentStep((prev) => {
                const newStep = Math.max(prev - 1, 1);
                console.log(`prevStep: currentStep becomes ${newStep}`);
                return newStep;
            });
        };

        const handleCancel = () => {
            console.log("handleCancel called");
            setFormState({ // Reset form completely
                name: '', age: '', minAge: '', maxAge: '', gender: 'male',
                genderPreference: 'any', personalityTraits: [], interests: [],
                maxRent: '', pets: 'any', lookingFor: '', description: '', rent: '',
                roomType: 'Single Room', petsAllowed: 'any', avgAge: '',
                lookingForInFlatmate: '', location: '',
                communalLivingPreferences: [], wgCommunalLiving: [], values: [], wgValues: []
            });
            setCurrentStep(1); // Go back to first step
        };


        const handleSubmit = async () => { // No event object directly from onSubmit
            console.log(`handleSubmit called. Current step: ${currentStep}`);

            // This check should now be redundant, as handleSubmit is only called by the final button,
            // but we leave it for safety.
            if (currentStep !== totalSteps) {
                console.log("handleSubmit: Not executed as not in the last step.");
                return;
            }

            console.log("handleSubmit: In the last step, data is being submitted.");
            const dataToSubmit = { ...formState };
            if (dataToSubmit.age) dataToSubmit.age = parseInt(dataToSubmit.age); 
            if (dataToSubmit.minAge) dataToSubmit.minAge = parseInt(dataToSubmit.minAge);
            if (dataToSubmit.maxAge) dataToSubmit.maxAge = parseInt(dataToSubmit.maxAge);
            if (dataToSubmit.maxRent) dataToSubmit.maxRent = parseInt(dataToSubmit.maxRent);
            if (dataToSubmit.rent) dataToSubmit.rent = parseInt(dataToSubmit.rent);
            if (dataToSubmit.avgAge) dataToSubmit.avgAge = parseInt(dataToSubmit.avgAge);

            await onSubmit(dataToSubmit); // Wait until data is saved
            console.log("handleSubmit: Data submitted, form is being reset.");
            setFormState({ // Reset form after saving
                name: '', age: '', minAge: '', maxAge: '', gender: 'male',
                genderPreference: 'any', personalityTraits: [], interests: [],
                maxRent: '', pets: 'any', lookingFor: '', description: '', rent: '',
                roomType: 'Single Room', petsAllowed: 'any', avgAge: '',
                lookingForInFlatmate: '', location: '',
                communalLivingPreferences: [], wgCommunalLiving: [], values: [], wgValues: []
            });
            setCurrentStep(1); // Go back to first step
        };

        return (
            <form className="p-8 bg-white rounded-2xl shadow-xl space-y-6 w-full max-w-xl mx-auto transform transition-all duration-300 hover:scale-[1.01]">
                <h2 className="text-3xl font-extrabold text-gray-800 mb-6 text-center">
                    {type === 'seeker' ? `Create Seeker Profile (Step ${currentStep}/${totalSteps})` : `Create WG Offer (Step ${currentStep}/${totalSteps})`}
                </h2>

                {/* --- STEP 1 --- */}
                {currentStep === 1 && (
                    <div className="space-y-4">
                        {/* Name / WG Name */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">
                                {type === 'seeker' ? 'Your Name:' : 'WG Name:'}
                            </label>
                            <input
                                type="text"
                                name="name"
                                value={formState.name}
                                onChange={handleChange}
                                required
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                            />
                        </div>

                        {/* Age (Seeker) / Age Range (Provider) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Your Age:</label>
                                <input
                                    type="number"
                                    name="age"
                                    value={formState.age}
                                    onChange={handleChange}
                                    required
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                />
                            </div>
                        )}
                        {type === 'provider' && (
                            <div className="flex space-x-4">
                                <div className="flex-1">
                                    <label className="block text-gray-700 text-base font-semibold mb-2">Min Flatmate Age:</label>
                                    <input
                                        type="number"
                                        name="minAge"
                                        value={formState.minAge}
                                        onChange={handleChange}
                                        required
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-gray-700 text-base font-semibold mb-2">Max Flatmate Age:</label>
                                    <input
                                        type="number"
                                        name="maxAge"
                                        value={formState.maxAge}
                                        onChange={handleChange}
                                        required
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Gender (Seeker) / Gender Preference (Provider) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Your Gender:</label>
                                <select
                                    name="gender"
                                    value={formState.gender}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                >
                                    <option value="male">Male</option>
                                    <option value="female">Female</option>
                                    <option value="diverse">Diverse</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Flatmate Gender Preference:</label>
                                <select
                                    name="genderPreference"
                                    value={formState.genderPreference}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                >
                                    <option value="any">Any</option>
                                    <option value="male">Male</option>
                                    <option value="female">Female</option>
                                    <option value="diverse">Diverse</option>
                                </select>
                            </div>
                        )}

                        {/* Location / City District (for both) */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">Location / City District:</label>
                            <input
                                type="text"
                                name="location"
                                value={formState.location}
                                onChange={handleChange}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                            />
                        </div>
                    </div>
                )}

                {/* --- STEP 2 --- */}
                {currentStep === 2 && (
                    <div className="space-y-4">
                        {/* Maximum Rent (Seeker) / Rent (Provider) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Maximum Rent (€):</label>
                                <input
                                    type="number"
                                    name="maxRent"
                                    value={formState.maxRent}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                />
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Rent (€):</label>
                                <input
                                    type="number"
                                    name="rent"
                                    value={formState.rent}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                />
                            </div>
                        )}

                        {/* Pets (Seeker) / Pets Allowed (Provider) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Pets:</label>
                                <select
                                    name="pets"
                                    value={formState.pets}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                >
                                    <option value="any">Any</option>
                                    <option value="yes">Yes</option>
                                    <option value="no">No</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Pets Allowed:</label>
                                <select
                                    name="petsAllowed"
                                    value={formState.petsAllowed}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                >
                                    <option value="any">Any</option>
                                    <option value="yes">Yes</option>
                                    <option value="no">No</option>
                                </select>
                            </div>
                        )}

                        {/* Personality Traits (for both) */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">
                                {type === 'seeker' ? 'Your Personality Traits:' : 'Current Residents\' Personality Traits:'}
                            </label>
                            <div className="grid grid-cols-2 gap-3 p-3 border border-gray-300 rounded-lg bg-gray-50">
                                {allPersonalityTraits.map(trait => (
                                    <label key={trait} className="inline-flex items-center text-gray-800 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            name="personalityTraits"
                                            value={trait}
                                            checked={formState.personalityTraits.includes(trait)}
                                            onChange={handleChange}
                                            className="form-checkbox h-5 w-5 text-[#3fd5c1] rounded focus:ring-2 focus:ring-[#3fd5c1]"
                                        />
                                        <span className="ml-2 text-sm">{trait}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Interests (for both) */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">
                                {type === 'seeker' ? 'Your Interests:' : 'Current Residents\' Interests:'}
                            </label>
                            <div className="grid grid-cols-2 gap-3 p-3 border border-gray-300 rounded-lg bg-gray-50">
                                {allInterests.map(interest => (
                                    <label key={interest} className="inline-flex items-center text-gray-800 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            name="interests"
                                            value={interest}
                                            checked={formState.interests.includes(interest)}
                                            onChange={handleChange}
                                            className="form-checkbox h-5 w-5 text-[#3fd5c1] rounded focus:ring-2 focus:ring-[#3fd5c1]"
                                        />
                                        <span className="ml-2 text-sm">{interest}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* New: Communal Living Preferences */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">
                                {type === 'seeker' ? 'Your Communal Living Preferences:' : 'WG Communal Living Preferences:'}
                            </label>
                            <div className="grid grid-cols-1 gap-3 p-3 border border-gray-300 rounded-lg bg-gray-50">
                                {allCommunalLivingPreferences.map(pref => (
                                    <label key={pref} className="inline-flex items-center text-gray-800 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            name={type === 'seeker' ? 'communalLivingPreferences' : 'wgCommunalLiving'}
                                            value={pref}
                                            checked={(formState[type === 'seeker' ? 'communalLivingPreferences' : 'wgCommunalLiving'] || []).includes(pref)}
                                            onChange={handleChange}
                                            className="form-checkbox h-5 w-5 text-[#3fd5c1] rounded focus:ring-2 focus:ring-[#3fd5c1]"
                                        />
                                        <span className="ml-2 text-sm">{pref}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* --- STEP 3 --- */}
                {currentStep === 3 && (
                    <div className="space-y-4">
                        {/* What is being sought (Seeker) / Description of the WG (Provider) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">What are you looking for in a WG?:</label>
                                <textarea
                                    name="lookingFor"
                                    value={formState.lookingFor}
                                    onChange={handleChange}
                                    rows="3"
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                ></textarea>
                            </div>
                        )}
                        {type === 'provider' && (
                            <>
                                <div>
                                    <label className="block text-gray-700 text-base font-semibold mb-2">Description of the WG:</label>
                                    <textarea
                                        name="description"
                                        value={formState.description}
                                        onChange={handleChange}
                                        rows="3"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                    ></textarea>
                                </div>
                                <div>
                                    <label className="block text-gray-700 text-base font-semibold mb-2">What are you looking for in a new flatmate?:</label>
                                    <textarea
                                        name="lookingForInFlatmate"
                                        value={formState.lookingForInFlatmate}
                                        onChange={handleChange}
                                        rows="3"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                ></textarea>
                                </div>
                            </>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Room Type:</label>
                                <select
                                    name="roomType"
                                    value={formState.roomType}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                >
                                    <option value="Single Room">Single Room</option>
                                    <option value="Double Room">Double Room</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Average Age of Residents:</label>
                                <input
                                    type="number"
                                    name="avgAge"
                                    value={formState.avgAge}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                />
                            </div>
                        )}

                        {/* New: Values */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">
                                {type === 'seeker' ? 'Your Values and Expectations for WG life:' : 'WG Values and Expectations:'}
                            </label>
                            <div className="grid grid-cols-1 gap-3 p-3 border border-gray-300 rounded-lg bg-gray-50">
                                {allWGValues.map(val => (
                                    <label key={val} className="inline-flex items-center text-gray-800 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            name={type === 'seeker' ? 'values' : 'wgValues'}
                                            value={val}
                                            checked={(formState[type === 'seeker' ? 'values' : 'wgValues'] || []).includes(val)}
                                            onChange={handleChange}
                                            className="form-checkbox h-5 w-5 text-[#3fd5c1] rounded focus:ring-2 focus:ring-[#3fd5c1]"
                                        />
                                        <span className="ml-2 text-sm">{val}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex justify-between mt-8">
                    <button
                        type="button"
                        onClick={handleCancel}
                        className="flex items-center px-6 py-3 bg-gray-300 text-gray-800 font-bold rounded-xl shadow-md hover:bg-gray-400 transition duration-150 ease-in-out transform hover:-translate-y-0.5"
                    >
                        <XCircle size={20} className="mr-2" /> Cancel
                    </button>
                    {currentStep > 1 && (
                        <button
                            type="button"
                            onClick={prevStep}
                            className="flex items-center px-6 py-3 bg-gray-300 text-gray-800 font-bold rounded-xl shadow-md hover:bg-gray-400 transition duration-150 ease-in-out transform hover:-translate-y-0.5"
                        >
                            Back
                        </button>
                    )}
                    {currentStep < totalSteps ? (
                        <button
                            type="button"
                            onClick={nextStep}
                            className="flex items-center px-6 py-3 bg-[#3fd5c1] text-white font-bold rounded-xl shadow-lg hover:bg-[#32c0ae] transition duration-150 ease-in-out transform hover:-translate-y-0.5"
                        >
                            Next
                        </button>
                    ) : (
                        <button
                            type="button" // Changed to type="button"
                            onClick={handleSubmit} // handleSubmit is now called directly here
                            className={`flex items-center px-6 py-3 font-bold rounded-xl shadow-lg transition duration-150 ease-in-out transform hover:-translate-y-0.5 ${
                                type === 'seeker'
                                    ? 'bg-[#9adfaa] hover:bg-[#85c292] text-[#333333]'
                                    : 'bg-[#fecd82] hover:bg-[#e6b772] text-[#333333]'
                            }`}
                        >
                            <CheckCircle size={20} className="mr-2" /> Save Profile
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
    const showMyWgDashboard = myWgProfiles.length > 0 && !adminMode;

    return (
        <div className="min-h-screen bg-[#3fd5c1] p-8 font-inter flex flex-col items-center relative overflow-hidden">
            {/* Background circles for visual dynamism */}
            <div className="absolute top-[-50px] left-[-50px] w-48 h-48 bg-white opacity-10 rounded-full animate-blob-slow"></div>
            <div className="absolute bottom-[-50px] right-[-50px] w-64 h-64 bg-white opacity-10 rounded-full animate-blob-medium"></div>
            <div className="absolute top-1/3 right-1/4 w-32 h-32 bg-white opacity-10 rounded-full animate-blob-fast"></div>


            <h1 className="text-5xl font-extrabold text-white mb-8 text-center drop-shadow-lg">Roomatch</h1>
            
            {userId && (
                <div className="bg-[#c3efe8] text-[#0a665a] text-sm px-6 py-3 rounded-full mb-8 shadow-md flex items-center transform transition-all duration-300 hover:scale-[1.02]">
                    <User size={18} className="mr-2" /> Your User ID: <span className="font-mono font-semibold ml-1">{userId}</span>
                    {userId === ADMIN_UID && (
                        <label className="ml-6 inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="form-checkbox h-5 w-5 text-[#3fd5c1] rounded-md transition-all duration-200 focus:ring-2 focus:ring-[#3fd5c1]"
                                checked={adminMode}
                                onChange={() => setAdminMode(!adminMode)}
                            />
                            <span className="ml-2 text-[#0a665a] font-bold select-none">Admin Mode</span>
                        </label>
                    )}
                </div>
            )}
            {saveMessage && (
                <div className="bg-green-100 text-green-700 px-5 py-3 rounded-lg mb-6 shadow-xl transition-all duration-300 scale-100 animate-fade-in-down">
                    {saveMessage}
                </div>
            )}

            {/* --- MAIN VIEWS (Admin Mode vs. Normal Mode) --- */}
            {adminMode ? (
                // ADMIN MODE ON: Show all admin dashboards
                <div className="w-full max-w-7xl flex flex-col gap-12">
                    <div className="bg-white p-10 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                        <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">Matches: Seeker finds WG (Admin View)</h2>
                        {matches.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg py-4">No matches found.</p>
                        ) : (
                            <div className="space-y-8">
                                {matches.map((match, index) => (
                                    <div key={index} className="bg-[#f0f8f0] p-8 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                        <h3 className="text-2xl font-bold text-[#333333] mb-4 flex items-center">
                                            <Search size={22} className="mr-3 text-[#5a9c68]" /> Seeker: <span className="font-extrabold ml-2">{match.searcher.name}</span> (ID: {match.searcher.id.substring(0, 8)}...)
                                        </h3>
                                        <h4 className="text-xl font-bold text-[#5a9c68] mb-4 flex items-center">
                                            <Heart size={20} className="mr-2" /> Matching WG Offers:
                                        </h4>
                                        <div className="space-y-4">
                                            {match.matchingWGs.length === 0 ? (
                                                <p className="text-gray-600 text-base">No matching WGs.</p>
                                            ) : (
                                                match.matchingWGs.map(wgMatch => (
                                                    <div key={wgMatch.wg.id} className="bg-white p-5 rounded-lg shadow border border-[#9adfaa] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                        <div>
                                                            <p className="font-bold text-gray-800 text-lg">WG Name: {wgMatch.wg.name} <span className="text-sm font-normal text-gray-600">(Score: {wgMatch.score})</span></p>
                                                            {/* Enhanced Score Display */}
                                                            <div className={`mt-2 px-3 py-1 rounded-full text-sm font-bold inline-block ${getScoreColorClass(wgMatch.score)}`}>
                                                                Score: {wgMatch.score.toFixed(0)}
                                                            </div>
                                                            <p className="text-sm text-gray-600 mt-2"><span className="font-medium">Desired Age:</span> {wgMatch.wg.minAge}-{wgMatch.wg.maxAge}, <span className="font-medium">Gender Preference:</span> {wgMatch.wg.genderPreference}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Interests:</span> {Array.isArray(wgMatch.wg.interests) ? wgMatch.wg.interests.join(', ') : (wgMatch.wg.interests || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Residents' Personality:</span> {Array.isArray(wgMatch.wg.personalityTraits) ? wgMatch.wg.personalityTraits.join(', ') : (wgMatch.wg.personalityTraits || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG Communal Living:</span> {Array.isArray(wgMatch.wg.wgCommunalLiving) ? wgMatch.wg.wgCommunalLiving.join(', ') : (wgMatch.wg.wgCommunalLiving || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG Values:</span> {Array.isArray(wgMatch.wg.wgValues) ? wgMatch.wg.wgValues.join(', ') : (wgMatch.wg.wgValues || 'N/A')}</p>
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

                    <div className="bg-white p-10 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                        <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">Matches: WG finds Seeker (Admin View)</h2>
                        {reverseMatches.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg py-4">No matches found.</p>
                        ) : (
                            <div className="space-y-8">
                                {reverseMatches.map((wgMatch, index) => (
                                    <div key={index} className="bg-[#fff8f0] p-8 rounded-xl shadow-lg border border-[#fecd82] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                        <h3 className="text-2xl font-bold text-[#333333] mb-4 flex items-center">
                                            <HomeIcon size={22} className="mr-3 text-[#cc8a2f]" /> WG Name: <span className="font-extrabold ml-2">{wgMatch.wg.name}</span> (ID: {wgMatch.wg.id.substring(0, 8)}...)
                                        </h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-gray-700 text-base mb-6">
                                            <p><span className="font-semibold">Desired Age:</span> {wgMatch.wg.minAge}-{wgMatch.wg.maxAge}</p>
                                            <p><span className="font-semibold">Gender Preference:</span> {wgMatch.wg.genderPreference}</p>
                                            <p><span className="font-semibold">Interests:</span> {Array.isArray(wgMatch.wg.interests) ? wgMatch.wg.interests.join(', ') : (wgMatch.wg.interests || 'N/A')}</p>
                                            <p className="text-sm text-gray-600"><span className="font-semibold">Residents' Personality:</span> {Array.isArray(wgMatch.wg.personalityTraits) ? wgMatch.wg.personalityTraits.join(', ') : (wgMatch.wg.personalityTraits || 'N/A')}</p>
                                            <p className="text-sm text-gray-600"><span className="font-medium">WG Communal Living:</span> {Array.isArray(wgMatch.wg.wgCommunalLiving) ? wgMatch.wg.wgCommunalLiving.join(', ') : (wgMatch.wg.wgCommunalLiving || 'N/A')}</p>
                                            <p className="text-sm text-gray-600"><span className="font-medium">WG Values:</span> {Array.isArray(wgMatch.wg.wgValues) ? wgMatch.wg.wgValues.join(', ') : (wgMatch.wg.wgValues || 'N/A')}</p>
                                        </div>

                                        <h4 className="text-xl font-bold text-[#cc8a2f] mb-4 flex items-center">
                                            <Users size={20} className="mr-2" /> Matching Seekers:
                                        </h4>
                                        <div className="space-y-4">
                                            {wgMatch.matchingSeekers.length === 0 ? (
                                                <p className="text-gray-600 text-base">No matching seekers for your WG profile.</p>
                                                            ) : (
                                                                wgMatch.matchingSeekers.map(seekerMatch => (
                                                                    <div key={seekerMatch.searcher.id} className="bg-white p-5 rounded-lg shadow border border-[#fecd82] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                        <div>
                                                            <p className="font-bold text-gray-800 text-lg">Seeker: {seekerMatch.searcher.name} <span className="text-sm font-normal text-gray-600">(Score: {seekerMatch.score})</span></p>
                                                            {/* Enhanced Score Display */}
                                                            <div className={`mt-2 px-3 py-1 rounded-full text-sm font-bold inline-block ${getScoreColorClass(seekerMatch.score)}`}>
                                                                Score: {seekerMatch.score.toFixed(0)}
                                                            </div>
                                                            <p className="text-sm text-gray-600 mt-2"><span className="font-medium">Age:</span> {seekerMatch.searcher.age}, <span className="font-medium">Gender:</span> {seekerMatch.searcher.gender}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Interests:</span> {Array.isArray(seekerMatch.searcher.interests) ? seekerMatch.searcher.interests.join(', ') : (seekerMatch.searcher.interests || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Personality:</span> {Array.isArray(seekerMatch.searcher.personalityTraits) ? seekerMatch.searcher.personalityTraits.join(', ') : (seekerMatch.searcher.personalityTraits || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG Preferences:</span> {Array.isArray(seekerMatch.searcher.communalLivingPreferences) ? seekerMatch.searcher.communalLivingPreferences.join(', ') : (seekerMatch.searcher.communalLivingPreferences || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Values:</span> {Array.isArray(seekerMatch.searcher.values) ? seekerMatch.searcher.values.join(', ') : (seekerMatch.searcher.values || 'N/A')}</p>
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

                    <div className="bg-white p-10 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                        <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">All Seeker Profiles (Admin View)</h2>
                        {allSearcherProfilesGlobal.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg py-4">No seeker profiles available yet.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {allSearcherProfilesGlobal.map(profile => (
                                    <div key={profile.id} className="bg-[#f0f8f0] p-6 rounded-xl shadow-lg border border-[#9adfaa] flex flex-col transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                        <p className="font-bold text-[#333333] text-lg mb-2">Name: {profile.name}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Age:</span> {profile.age}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Gender:</span> {profile.gender}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Interests:</span> {Array.isArray(profile.interests) ? profile.interests.join(', ') : (profile.interests || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Personality:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.join(', ') : (profile.personalityTraits || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">WG Preferences:</span> {Array.isArray(profile.communalLivingPreferences) ? profile.communalLivingPreferences.join(', ') : (profile.communalLivingPreferences || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Values:</span> {Array.isArray(profile.values) ? profile.values.join(', ') : (profile.values || 'N/A')}</p>
                                        <p className="text-xs text-gray-500 mt-4">Created by: {profile.createdBy.substring(0, 8)}...</p>
                                        <p className="text-xs text-gray-500">On: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                                        <button
                                            onClick={() => handleDeleteProfile('searcherProfiles', profile.id, profile.name, profile.createdBy)}
                                            className="mt-6 px-5 py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out self-end flex items-center transform hover:-translate-y-0.5"
                                        >
                                            <Trash2 size={16} className="mr-2" /> Delete
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="bg-white p-10 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-12">
                        <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">All WG Offers (Admin View)</h2>
                        {allWgProfilesGlobal.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg py-4">No WG offers available yet.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {allWgProfilesGlobal.map(profile => (
                                    <div key={profile.id} className="bg-[#fff8f0] p-6 rounded-xl shadow-lg border border-[#fecd82] flex flex-col transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                        <p className="font-bold text-[#333333] text-lg mb-2">WG Name: {profile.name}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Desired Age:</span> {profile.minAge}-{profile.maxAge}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Gender Preference:</span> {profile.genderPreference}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Interests:</span> {Array.isArray(profile.interests) ? profile.interests.join(', ') : (profile.interests || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Residents' Personality:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.join(', ') : (profile.personalityTraits || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-medium">WG Communal Living:</span> {Array.isArray(profile.wgCommunalLiving) ? profile.wgCommunalLiving.join(', ') : (profile.wgCommunalLiving || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-medium">WG Values:</span> {Array.isArray(profile.wgValues) ? profile.wgValues.join(', ') : (profile.wgValues || 'N/A')}</p>
                                        <p className="text-xs text-gray-500 mt-4">Created by: {profile.createdBy.substring(0, 8)}...</p>
                                        <p className="text-xs text-gray-500">On: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                                        <button
                                            onClick={() => handleDeleteProfile('wgProfiles', profile.id, profile.name, profile.createdBy)}
                                            className="mt-6 px-5 py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out self-end flex items-center transform hover:-translate-y-0.5"
                                        >
                                            <Trash2 size={16} className="mr-2" /> Delete
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                // NORMAL MODE: Show form selection + forms and then dashboards (if available)
                <div className="w-full max-w-7xl flex flex-col gap-12">
                    {/* Form Selection Buttons */}
                    <div className="w-full max-w-4xl flex flex-col sm:flex-row justify-center space-y-4 sm:space-y-0 sm:space-x-6 mb-12 mx-auto">
                        <button
                            onClick={() => setShowSeekerForm(true)}
                            className={`flex items-center justify-center px-8 py-4 rounded-xl text-xl font-semibold shadow-xl transition-all duration-300 transform hover:scale-105 hover:shadow-2xl ${
                                showSeekerForm
                                    ? 'bg-[#9adfaa] text-[#333333]'
                                    : 'bg-white text-[#9adfaa] hover:bg-gray-50'
                            }`}
                        >
                            <Search size={24} className="mr-3" /> Seeker Profile
                        </button>
                        <button
                            onClick={() => setShowSeekerForm(false)}
                            className={`flex items-center justify-center px-8 py-4 rounded-xl text-xl font-semibold shadow-xl transition-all duration-300 transform hover:scale-105 hover:shadow-2xl ${
                                !showSeekerForm
                                    ? 'bg-[#fecd82] text-[#333333]'
                                    : 'bg-white text-[#fecd82] hover:bg-gray-50'
                            }`}
                        >
                            <HomeIcon size={24} className="mr-3" /> WG Offer
                        </button>
                    </div>

                    {/* Current Form */}
                    <div className="w-full max-w-xl mb-12 mx-auto">
                        <ProfileForm onSubmit={showSeekerForm ? addSearcherProfile : addWGProfile} type={showSeekerForm ? "seeker" : "provider"} key={showSeekerForm ? "seekerForm" : "providerForm"} />
                    </div>

                    {/* User Dashboards (if profiles exist) */}
                    {(showMySeekerDashboard || showMyWgDashboard) ? (
                        // Wrapping Div to avoid Adjacent JSX if both dashboards exist
                        <div className="flex flex-col gap-12 w-full"> 
                            {showMySeekerDashboard && (
                                <div className="bg-white p-10 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-12">
                                    <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">My Matches: Seeker finds WG</h2>
                                    {matches.filter(match => match.searcher.createdBy === userId).length === 0 ? (
                                        <p className="text-center text-gray-600 text-lg py-4">
                                            You haven't created any seeker profiles yet or no matches were found.
                                        </p>
                                    ) : (
                                        <div className="space-y-8">
                                            {matches
                                                .filter(match => match.searcher.createdBy === userId)
                                                .map((match, index) => (
                                                    <div key={index} className="bg-[#f0f8f0] p-8 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                                        <h3 className="text-2xl font-bold text-[#333333] mb-4 flex items-center">
                                                            <Search size={22} className="mr-3 text-[#5a9c68]" /> Your Profile: <span className="font-extrabold ml-2">{match.searcher.name}</span>
                                                        </h3>
                                                        <h4 className="text-xl font-bold text-[#5a9c68] mb-4 flex items-center">
                                                            <Heart size={20} className="mr-2" /> Matching WG Offers:
                                                        </h4>
                                                        <div className="space-y-4">
                                                            {match.matchingWGs.length === 0 ? (
                                                                <p className="text-gray-600 text-base">No matching WGs for your profile.</p>
                                                            ) : (
                                                                match.matchingWGs.map(wgMatch => (
                                                                    <div key={wgMatch.wg.id} className="bg-white p-5 rounded-lg shadow border border-[#9adfaa] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                                        <div>
                                                                            <p className="font-bold text-gray-800 text-lg">WG Name: {wgMatch.wg.name}</p>
                                                                            {/* Enhanced Score Display */}
                                                                            <div className={`mt-2 px-3 py-1 rounded-full text-sm font-bold inline-block ${getScoreColorClass(wgMatch.score)}`}>
                                                                                Score: {wgMatch.score.toFixed(0)}
                                                                            </div>
                                                                            <p className="text-sm text-gray-600 mt-2"><span className="font-medium">Desired Age:</span> {wgMatch.wg.minAge}-{wgMatch.wg.maxAge}, <span className="font-medium">Gender Preference:</span> {wgMatch.wg.genderPreference}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Interests:</span> {Array.isArray(wgMatch.wg.interests) ? wgMatch.wg.interests.join(', ') : (wgMatch.wg.interests || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Residents' Personality:</span> {Array.isArray(wgMatch.wg.personalityTraits) ? wgMatch.wg.personalityTraits.join(', ') : (wgMatch.wg.personalityTraits || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG Communal Living:</span> {Array.isArray(wgMatch.wg.wgCommunalLiving) ? wgMatch.wg.wgCommunalLiving.join(', ') : (wgMatch.wg.wgCommunalLiving || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG Values:</span> {Array.isArray(wgMatch.wg.wgValues) ? wgMatch.wg.wgValues.join(', ') : (wgMatch.wg.wgValues || 'N/A')}</p>
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
                            )}

                            {showMyWgDashboard && (
                                <div className="bg-white p-10 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-12">
                                    <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">My Matches: WG finds Seeker</h2>
                                    {reverseMatches.filter(wgMatch => wgMatch.wg.createdBy === userId).length === 0 ? (
                                        <p className="text-center text-gray-600 text-lg py-4">
                                            You haven't created any WG offers yet or no matches were found.
                                        </p>
                                    ) : (
                                        <div className="space-y-8">
                                            {reverseMatches
                                                .filter(wgMatch => wgMatch.wg.createdBy === userId)
                                                .map((wgMatch, index) => (
                                                    <div key={index} className="bg-[#fff8f0] p-8 rounded-xl shadow-lg border border-[#fecd82] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                                        <h3 className="text-2xl font-bold text-[#333333] mb-4 flex items-center">
                                                            <HomeIcon size={22} className="mr-3 text-[#cc8a2f]" /> Your WG Profile: <span className="font-extrabold ml-2">{wgMatch.wg.name}</span>
                                                        </h3>
                                                        <h4 className="text-xl font-bold text-[#cc8a2f] mb-4 flex items-center">
                                                            <Users size={20} className="mr-2" /> Matching Seekers:
                                                        </h4>
                                                        <div className="space-y-4">
                                                            {wgMatch.matchingSeekers.length === 0 ? (
                                                                <p className="text-gray-600 text-base">No matching seekers for your WG profile.</p>
                                                            ) : (
                                                                wgMatch.matchingSeekers.map(seekerMatch => (
                                                                    <div key={seekerMatch.searcher.id} className="bg-white p-5 rounded-lg shadow border border-[#fecd82] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                                        <div>
                                                                            <p className="font-bold text-gray-800 text-lg">Seeker: {seekerMatch.searcher.name}</p>
                                                                            {/* Enhanced Score Display */}
                                                                            <div className={`mt-2 px-3 py-1 rounded-full text-sm font-bold inline-block ${getScoreColorClass(seekerMatch.score)}`}>
                                                                                Score: {seekerMatch.score.toFixed(0)}
                                                                            </div>
                                                                            <p className="text-sm text-gray-600 mt-2"><span className="font-medium">Age:</span> {seekerMatch.searcher.age}, <span className="font-medium">Gender:</span> {seekerMatch.searcher.gender}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Interests:</span> {Array.isArray(seekerMatch.searcher.interests) ? seekerMatch.searcher.interests.join(', ') : (seekerMatch.searcher.interests || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Personality:</span> {Array.isArray(seekerMatch.searcher.personalityTraits) ? seekerMatch.searcher.personalityTraits.join(', ') : (seekerMatch.searcher.personalityTraits || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG Preferences:</span> {Array.isArray(seekerMatch.searcher.communalLivingPreferences) ? seekerMatch.searcher.communalLivingPreferences.join(', ') : (seekerMatch.searcher.communalLivingPreferences || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Values:</span> {Array.isArray(seekerMatch.searcher.values) ? seekerMatch.searcher.values.join(', ') : (seekerMatch.searcher.values || 'N/A')}</p>
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
                            )}
                        </div> 
                    ) : (
                        // Message when no own profiles have been created and not in admin mode
                        <div className="w-full max-w-xl bg-white p-8 rounded-2xl shadow-xl text-center text-gray-600 mb-12 mx-auto">
                            <p className="text-lg">Please create a Seeker Profile or a WG Offer to see your matches.</p>
                            <button
                                onClick={() => setShowSeekerForm(true)}
                                className="mt-6 px-6 py-3 bg-[#3fd5c1] text-white font-bold rounded-xl shadow-lg hover:bg-[#32c0ae] transition duration-150 ease-in-out transform hover:-translate-y-0.5"
                            >
                                <span className="flex items-center"><Search size={20} className="mr-2" /> Create Profile</span>
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default App;