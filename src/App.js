import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc } from 'firebase/firestore'; // Import 'where'

// Firebase-Konfiguration
// YOUR ACTUAL FIREBASE CONFIG DATA IS INSERTED HERE!
const firebaseConfig = {
    apiKey: "AIzaSyACGoSxD0_UZhWg06gzZjaifBn3sI06YGg", // <--- HIER WURDE DEIN NEUER API KEY EINGEFÜGT!
    authDomain: "mvp-roomatch.firebaseapp.com",
    projectId: "mvp-roomatch",
    storageBucket: "mvp-roomatch.firebasestorage.app",
    messagingSenderId: "190918526277",
    appId: "1:190918526277:web:268e07e2f1f326b8e86a2c",
    measurementId: "G-5JPWLDD0ZC"
};

// Predefined lists for personality traits and interests
const allPersonalityTraits = ['ordentlich', 'ruhig', 'gesellig', 'kreativ', 'sportlich', 'nachtaktiv', 'frühaufsteher'];
const allInterests = ['Kochen', 'Filme', 'Musik', 'Spiele', 'Natur', 'Sport', 'Lesen', 'Reisen', 'Feiern', 'Gaming'];

// **IMPORTANT:** REPLACE THIS VALUE EXACTLY WITH YOUR ADMIN ID DISPLAYED IN THE APP!
// Copy it directly from the app to avoid errors.
const ADMIN_UID = "H9jtz5aHKkcN7JCjtTPL7t32rtE3"; 

// Function to calculate the match score between a seeker and a flatshare profile
const calculateMatchScore = (seeker, wg) => {
    let score = 0;

    // Helper to get consistent data access for array fields
    const getArrayValue = (profile, field) => {
        const value = profile[field];
        return Array.isArray(value) ? value : (value ? String(value).split(',').map(s => s.trim()) : []);
    };

    // 1. Age match (seeker age vs. flatshare age range)
    if (seeker.age && wg.minAge && wg.maxAge) {
        if (seeker.age >= wg.minAge && seeker.age <= wg.maxAge) {
            score += 20;
        } else {
            score -= 15;
        }
    }

    // 2. Gender preference
    if (seeker.gender && wg.genderPreference) {
        if (wg.genderPreference === 'egal' || seeker.gender === wg.genderPreference) {
            score += 10;
        } else {
            score -= 10;
        }
    }

    // 3. Personality traits (match)
    const seekerTraits = getArrayValue(seeker, 'personalityTraits');
    const wgTraits = getArrayValue(wg, 'personalityTraits');
    seekerTraits.forEach(trait => {
        if (wgTraits.includes(trait)) {
            score += 5;
        }
    });

    // 4. Interests (overlap)
    const seekerInterests = getArrayValue(seeker, 'interests');
    const wgInterests = getArrayValue(wg, 'interests');
    seekerInterests.forEach(interest => {
        if (wgInterests.includes(interest)) {
            score += 3;
        }
    });

    // 5. Rent price (seeker max rent >= flatshare rent)
    if (seeker.maxRent && wg.rent) {
        if (seeker.maxRent >= wg.rent) {
            score += 15;
        } else {
            score -= 15;
        }
    }

    // 6. Pets (match)
    if (seeker.pets && wg.petsAllowed) {
        if (seeker.pets === 'ja' && wg.petsAllowed === 'ja') {
            score += 8;
        } else if (seeker.pets === 'ja' && wg.petsAllowed === 'nein') {
            score -= 8;
        }
    }

    // 7. Free text 'lookingFor' (seeker) vs. 'description'/'lookingForInFlatmate' (flatshare)
    const seekerLookingFor = (seeker.lookingFor || '').toLowerCase();
    const wgDescription = (wg.description || '').toLowerCase();
    const wgLookingForInFlatmate = (wg.lookingForInFlatmate || '').toLowerCase();

    const seekerKeywords = seekerLookingFor.split(' ').filter(word => word.length > 2);
    seekerKeywords.forEach(keyword => {
        if (wgDescription.includes(keyword) || wgLookingForInFlatmate.includes(keyword)) {
            score += 1;
        }
    });

    // 8. Average age of flatshare residents compared to seeker age
    if (seeker.age && wg.avgAge) {
        score -= Math.abs(seeker.age - wg.avgAge);
    }

    return score;
};


// Main component of the flatshare match application
function App() {
    // States for the *own* profiles of the logged-in user
    const [mySearcherProfiles, setMySearcherProfiles] = useState([]);
    const [myWgProfiles, setMyWgProfiles] = useState([]);
    
    // States for *all* profiles (for match calculations and admin view)
    const [allSearcherProfilesGlobal, setAllSearcherProfilesGlobal] = useState([]);
    const [allWgProfilesGlobal, setAllWgProfilesGlobal] = useState([]);

    const [matches, setMatches] = useState([]); // Matches: Seeker finds flatshare
    const [reverseMatches, setReverseMatches] = useState([]); // Reverse matches: Flatshare finds seeker
    
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showSeekerForm, setShowSeekerForm] = useState(true);
    const [saveMessage, setSaveMessage] = useState('');
    const [adminMode, setAdminMode] = useState(false); // State for admin mode

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
                        setError("Error logging in. Please try again later.");
                        setLoading(false);
                        return;
                    }
                }
                const currentUid = authInstance.currentUser?.uid || 'anonymous-' + Date.now() + '-' + Math.random().toString(36).substring(2);
                setUserId(currentUid);
                setAdminMode(currentUid === ADMIN_UID); 
                setLoading(false); // Set loading to false after successful authentication
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

    // Real-time data retrieval for *own* seeker profiles from Firestore
    useEffect(() => {
        if (!db || !userId) return;

        const mySearchersQuery = query(collection(db, `searcherProfiles`), where('createdBy', '==', userId));

        const unsubscribeMySearchers = onSnapshot(mySearchersQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMySearcherProfiles(profiles);
        }, (err) => {
            console.error("Error retrieving own seeker profiles:", err);
            setError("Error loading own seeker profiles.");
        });

        return () => unsubscribeMySearchers();
    }, [db, userId]);

    // Real-time data retrieval for *own* flatshare profiles from Firestore
    useEffect(() => {
        if (!db || !userId) return;

        const myWgsQuery = query(collection(db, `wgProfiles`), where('createdBy', '==', userId));

        const unsubscribeMyWGs = onSnapshot(myWgsQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMyWgProfiles(profiles);
        }, (err) => {
            console.error("Error retrieving own flatshare profiles:", err);
            setError("Error loading own flatshare profiles.");
        });

        return () => unsubscribeMyWGs();
    }, [db, userId]);


    // Real-time data retrieval for *all* seeker profiles (for match calculation)
    useEffect(() => {
        if (!db) return; // No userId filter, as all are retrieved

        const allSearchersQuery = query(collection(db, `searcherProfiles`));
        const unsubscribeAllSearchers = onSnapshot(allSearchersQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setAllSearcherProfilesGlobal(profiles);
        }, (err) => {
            console.error("Error retrieving all seeker profiles (global):", err);
        });

        return () => unsubscribeAllSearchers();
    }, [db]); // Dependency only on 'db'

    // Real-time data retrieval for *all* flatshare profiles (for match calculation)
    useEffect(() => {
        if (!db) return; // No userId filter, as all are retrieved

        const allWgsQuery = query(collection(db, `wgProfiles`));
        const unsubscribeAllWGs = onSnapshot(allWgsQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setAllWgProfilesGlobal(profiles);
        }, (err) => {
            console.error("Error retrieving all flatshare profiles (global):", err);
        });

        return () => unsubscribeAllWGs();
    }, [db]); // Dependency only on 'db'


    // Match calculation for both directions
    useEffect(() => {
        const calculateAllMatches = () => {
            // For seeker-finds-flatshare matches
            const newSeekerToWGMatches = [];
            // Normal users match their own seeker profiles against ALL flatshare profiles
            // Admins match all seeker profiles against ALL flatshare profiles
            const seekersForMatching = adminMode ? allSearcherProfilesGlobal : mySearcherProfiles;
            
            seekersForMatching.forEach(searcher => {
                const matchingWGs = allWgProfilesGlobal.map(wg => {
                    const score = calculateMatchScore(searcher, wg);
                    return { wg, score };
                });

                matchingWGs.sort((a, b) => b.score - a.score);

                newSeekerToWGMatches.push({
                    searcher: searcher,
                    matchingWGs: matchingWGs
                });
            });
            setMatches(newSeekerToWGMatches);

            // For flatshare-finds-seeker matches
            const newWGToSeekerMatches = [];
            // Normal users match their own flatshare profiles against ALL seeker profiles
            // Admins match all flatshare profiles against ALL seeker profiles
            const wgsForMatching = adminMode ? allWgProfilesGlobal : myWgProfiles;

            wgsForMatching.forEach(wg => {
                const matchingSeekers = allSearcherProfilesGlobal.map(searcher => {
                    const score = calculateMatchScore(searcher, wg);
                    return { searcher, score };
                });

                matchingSeekers.sort((a, b) => b.score - a.score);

                newWGToSeekerMatches.push({
                    wg: wg,
                    matchingSeekers: matchingSeekers
                });
            });
            setReverseMatches(newWGToSeekerMatches);
        };

        // Calculate matches once all relevant data is loaded
        // and only if db and userId are present and loading is false.
        if (!loading && db && userId) { 
            calculateAllMatches();
        } else if (mySearcherProfiles.length === 0 && myWgProfiles.length === 0 && !loading) {
            // Set matches to empty if no own profiles exist and everything is loaded
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
                createdBy: userId, // Profile is assigned to the current user
            });
            setSaveMessage('Seeker profile successfully saved!');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e) {
            console.error("Error adding seeker profile: ", e);
            setError("Error saving seeker profile.");
        }
    };

    // Function to add a flatshare profile to Firestore
    const addWGProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Database not ready. Please wait or log in.");
            return;
        }
        try {
            await addDoc(collection(db, `wgProfiles`), {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId, // Profile is assigned to the current user
            });
            setSaveMessage('Flatshare profile successfully saved!');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e) {
            console.error("Error adding flatshare profile: ", e);
            setError("Error saving flatshare profile.");
        }
    };

    // Function to delete a profile
    const handleDeleteProfile = async (collectionName, docId, profileName, profileCreatorId) => {
        if (!db || !userId) {
            setError("Database not ready for deletion.");
            return;
        }

        // Check if the user is authorized to delete
        // THIS LOGIC CONTROLS THE VISIBILITY OF THE DELETE BUTTON AND THE AUTHORIZATION
        if (!adminMode && userId !== profileCreatorId) {
            setError("You are not authorized to delete this profile.");
            setTimeout(() => setError(''), 3000);
            return;
        }

        const confirmDelete = window.confirm(`Do you really want to delete the profile "${profileName}"?`);

        if (confirmDelete) {
            try {
                await deleteDoc(doc(db, collectionName, docId));
                setSaveMessage(`Profile "${profileName}" successfully deleted!`);
                setTimeout(() => setSaveMessage(''), 3000);
            } catch (e) {
                console.error(`Error deleting profile ${profileName}: `, e);
                setError(`Error deleting profile "${profileName}".`);
            }
        }
    };

    // Unified profile form component
    const ProfileForm = ({ onSubmit, type }) => {
        const [formState, setFormState] = useState({
            name: '',
            age: '', minAge: '', maxAge: '',
            gender: 'männlich', genderPreference: 'egal',
            personalityTraits: [],
            interests: [],
            maxRent: '', pets: 'egal', lookingFor: '',
            description: '', rent: '', roomType: 'Einzelzimmer', petsAllowed: 'egal',
            avgAge: '', lookingForInFlatmate: '',
            location: '',
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

        const handleSubmit = (e) => {
            e.preventDefault();
            const dataToSubmit = { ...formState };
            if (dataToSubmit.age) dataToSubmit.age = parseInt(dataToSubmit.age);
            if (dataToSubmit.minAge) dataToSubmit.minAge = parseInt(dataToSubmit.minAge);
            if (dataToSubmit.maxAge) dataToSubmit.maxAge = parseInt(dataToSubmit.maxAge);
            if (dataToSubmit.maxRent) dataToSubmit.maxRent = parseInt(dataToSubmit.maxRent);
            if (dataToSubmit.rent) dataToSubmit.rent = parseInt(dataToSubmit.rent);
            if (dataToSubmit.avgAge) dataToSubmit.avgAge = parseInt(dataToSubmit.avgAge);

            onSubmit(dataToSubmit);
            setFormState({
                name: '', age: '', minAge: '', maxAge: '', gender: 'männlich',
                genderPreference: 'egal', personalityTraits: [], interests: [],
                maxRent: '', pets: 'egal', lookingFor: '', description: '', rent: '',
                roomType: 'Einzelzimmer', petsAllowed: 'egal', avgAge: '',
                lookingForInFlatmate: '', location: ''
            });
        };

        return (
            <form onSubmit={handleSubmit} className="p-6 bg-white rounded-xl shadow-lg space-y-4 w-full max-w-xl">
                <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">
                    {type === 'seeker' ? 'Suchenden-Profil erstellen' : 'WG-Angebot erstellen'}
                </h2>

                {/* Name / WG-Name */}
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">
                        {type === 'seeker' ? 'Dein Name:' : 'Name der WG:'}
                    </label>
                    <input
                        type="text"
                        name="name"
                        value={formState.name}
                        onChange={handleChange}
                        required
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                </div>

                {/* Alter (Suchender) / Altersbereich (Anbieter) */}
                {type === 'seeker' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Dein Alter:</label>
                        <input
                            type="number"
                            name="age"
                            value={formState.age}
                            onChange={handleChange}
                            required
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        />
                    </div>
                )}
                {type === 'provider' && (
                    <div className="flex space-x-4">
                        <div className="flex-1">
                            <label className="block text-gray-700 text-sm font-bold mb-2">Mindestalter Mitbewohner:</label>
                            <input
                                type="number"
                                name="minAge"
                                value={formState.minAge}
                                onChange={handleChange}
                                required
                                className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="block text-gray-700 text-sm font-bold mb-2">Höchstalter Mitbewohner:</label>
                            <input
                                type="number"
                                name="maxAge"
                                value={formState.maxAge}
                                onChange={handleChange}
                                required
                                className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                            />
                        </div>
                    </div>
                )}

                {/* Geschlecht (Suchender) / Geschlechtspräferenz (Anbieter) */}
                {type === 'seeker' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Dein Geschlecht:</label>
                        <select
                            name="gender"
                            value={formState.gender}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        >
                            <option value="männlich">Männlich</option>
                            <option value="weiblich">Weiblich</option>
                            <option value="divers">Divers</option>
                        </select>
                    </div>
                )}
                {type === 'provider' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Geschlechtspräferenz Mitbewohner:</label>
                        <select
                            name="genderPreference"
                            value={formState.genderPreference}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        >
                            <option value="egal">Egal</option>
                            <option value="männlich">Männlich</option>
                            <option value="weiblich">Weiblich</option>
                            <option value="divers">Divers</option>
                        </select>
                    </div>
                )}

                {/* Personality traits (for both) */}
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">
                        {type === 'seeker' ? 'Deine Persönlichkeitsmerkmale:' : 'Persönlichkeitsmerkmale der aktuellen Bewohner:'}
                    </label>
                    <div className="grid grid-cols-2 gap-2 p-2 border rounded-xl bg-gray-50">
                        {allPersonalityTraits.map(trait => (
                            <label key={trait} className="inline-flex items-center text-gray-800">
                                <input
                                    type="checkbox"
                                    name="personalityTraits"
                                    value={trait}
                                    checked={formState.personalityTraits.includes(trait)}
                                    onChange={handleChange}
                                    className="form-checkbox h-5 w-5 text-blue-600 rounded"
                                />
                                <span className="ml-2">{trait}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Interests (for both) */}
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">
                        {type === 'seeker' ? 'Deine Interessen:' : 'Interessen der aktuellen Bewohner:'}
                    </label>
                    <div className="grid grid-cols-2 gap-2 p-2 border rounded-xl bg-gray-50">
                        {allInterests.map(interest => (
                            <label key={interest} className="inline-flex items-center text-gray-800">
                                <input
                                    type="checkbox"
                                    name="interests"
                                    value={interest}
                                    checked={formState.interests.includes(interest)}
                                    onChange={handleChange}
                                    className="form-checkbox h-5 w-5 text-blue-600 rounded"
                                />
                                <span className="ml-2">{interest}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Maximum rent (seeker) / Rent (provider) */}
                {type === 'seeker' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Maximale Miete (€):</label>
                        <input
                            type="number"
                            name="maxRent"
                            value={formState.maxRent}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        />
                    </div>
                )}
                {type === 'provider' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Miete (€):</label>
                        <input
                            type="number"
                            name="rent"
                            value={formState.rent}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        />
                    </div>
                )}

                {/* Pets (seeker) / Pets allowed (provider) */}
                {type === 'seeker' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Haustiere:</label>
                        <select
                            name="pets"
                            value={formState.pets}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        >
                            <option value="egal">Egal</option>
                            <option value="ja">Ja</option>
                            <option value="nein">Nein</option>
                        </select>
                    </div>
                )}
                {type === 'provider' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Haustiere erlaubt:</label>
                        <select
                            name="petsAllowed"
                            value={formState.petsAllowed}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        >
                            <option value="egal">Egal</option>
                            <option value="ja">Ja</option>
                            <option value="nein">Nein</option>
                        </select>
                    </div>
                )}

                {/* What is being searched for (seeker) / Flatshare description (provider) */}
                {type === 'seeker' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Was suchst du in einer WG?:</label>
                        <textarea
                            name="lookingFor"
                            value={formState.lookingFor}
                            onChange={handleChange}
                            rows="3"
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        ></textarea>
                    </div>
                )}
                {type === 'provider' && (
                    <>
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-2">Beschreibung der WG:</label>
                            <textarea
                                name="description"
                                value={formState.description}
                                onChange={handleChange}
                                rows="3"
                                className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                            ></textarea>
                        </div>
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-2">Was sucht ihr im neuen Mitbewohner?:</label>
                            <textarea
                                name="lookingForInFlatmate"
                                value={formState.lookingForInFlatmate}
                                onChange={handleChange}
                                rows="3"
                                className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                            ></textarea>
                        </div>
                    </>
                )}
                {type === 'provider' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Zimmertyp:</label>
                        <select
                            name="roomType"
                            value={formState.roomType}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        >
                            <option value="Einzelzimmer">Einzelzimmer</option>
                            <option value="Doppelzimmer">Doppelzimmer</option>
                        </select>
                    </div>
                )}
                {type === 'provider' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Durchschnittsalter der Bewohner:</label>
                        <input
                            type="number"
                            name="avgAge"
                            value={formState.avgAge}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        />
                    </div>
                )}

                {/* Location / District (for both) */}
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">Ort / Stadtteil:</label>
                    <input
                        type="text"
                        name="location"
                        value={formState.location}
                        onChange={handleChange}
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                </div>


                <div className="flex justify-between mt-6">
                    <button
                        type="button"
                        onClick={() => setShowSeekerForm(true)} // Back to form selection
                        className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-xl focus:outline-none focus:shadow-outline transition duration-150 ease-in-out"
                    >
                        Abbrechen
                    </button>
                    <button
                        type="submit"
                        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl focus:outline-none focus:shadow-outline transition duration-150 ease-in-out"
                    >
                        Profil speichern
                    </button>
                </div>
            </form>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <p className="text-gray-700 text-lg">Lade App und Daten...</p>
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

    // Determine which dashboards should be displayed
    const showMySeekerDashboard = mySearcherProfiles.length > 0 && !adminMode;
    const showMyWgDashboard = myWgProfiles.length > 0 && !adminMode;
    const showAdminDashboard = adminMode;

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-200 p-8 font-inter flex flex-col items-center">
            <h1 className="text-5xl font-extrabold text-gray-900 mb-6 text-center">WG-Match App</h1>
            {userId && (
                <div className="bg-blue-200 text-blue-800 text-sm px-4 py-2 rounded-full mb-6 shadow">
                    Ihre Benutzer-ID: <span className="font-mono font-semibold">{userId}</span>
                    {/* Toggle for admin mode, only visible for ADMIN_UID */}
                    {userId === ADMIN_UID && (
                        <label className="ml-4 inline-flex items-center">
                            <input
                                type="checkbox"
                                className="form-checkbox h-5 w-5 text-purple-600 rounded"
                                checked={adminMode}
                                onChange={() => setAdminMode(!adminMode)}
                            />
                            <span className="ml-2 text-purple-800 font-bold">Admin-Modus</span>
                        </label>
                    )}
                </div>
            )}
            {saveMessage && (
                <div className="bg-green-100 text-green-700 px-4 py-2 rounded-lg mb-4 shadow-md transition-all duration-300">
                    {saveMessage}
                </div>
            )}

            {/* Form selection buttons only displayed if neither admin nor user dashboard is active AND not in admin mode */}
            {!showAdminDashboard && !showMySeekerDashboard && !showMyWgDashboard && !adminMode && (
                <div className="w-full max-w-4xl flex justify-center space-x-4 mb-8">
                    <button
                        onClick={() => setShowSeekerForm(true)}
                        className={`px-6 py-3 rounded-full text-lg font-semibold shadow-md transition-all duration-200 ${
                            showSeekerForm
                                ? 'bg-blue-600 text-white transform scale-105'
                                : 'bg-white text-blue-800 hover:bg-blue-50'
                        }`}
                    >
                        Suchenden-Profil
                    </button>
                    <button
                        onClick={() => setShowSeekerForm(false)}
                        className={`px-6 py-3 rounded-full text-lg font-semibold shadow-md transition-all duration-200 ${
                            !showSeekerForm
                                ? 'bg-green-600 text-white transform scale-105'
                                : 'bg-white text-green-800 hover:bg-green-50'
                        }`}
                    >
                        WG-Angebot
                    </button>
                </div>
            )}

            {/* Forms are displayed only if not in admin mode */}
            {!adminMode && (
                <div className="w-full max-w-xl mb-12">
                    {showSeekerForm ? (
                        <ProfileForm onSubmit={addSearcherProfile} type="seeker" />
                    ) : (
                        <ProfileForm onSubmit={addWGProfile} type="provider" />
                    )}
                </div>
            )}

            {/* --- DASHBOARD SECTIONS (Conditional Rendering) --- */}

            {/* Admin Dashboard */}
            {showAdminDashboard && (
                <>
                    <div className="w-full max-w-6xl bg-white p-8 rounded-xl shadow-2xl mt-8">
                        <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Matches: Suchender findet WG (Admin-Ansicht)</h2>
                        {matches.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg">Keine Matches gefunden.</p>
                        ) : (
                            <div className="space-y-8">
                                {matches.map((match, index) => (
                                    <div key={index} className="bg-blue-50 p-6 rounded-lg shadow-inner border border-blue-200">
                                        <h3 className="text-xl font-semibold text-blue-700 mb-3">
                                            Suchender: <span className="font-bold">{match.searcher.name}</span> (ID: {match.searcher.id.substring(0, 8)}...)
                                        </h3>
                                        <p className="text-gray-700 mb-2">Alter: {match.searcher.age}, Geschlecht: {match.searcher.gender}</p>
                                        <p className="text-gray-700 mb-4">Interessen: {Array.isArray(match.searcher.interests) ? match.searcher.interests.join(', ') : (match.searcher.interests || 'N/A')}</p>
                                        <p className="text-gray-700 mb-4">Persönlichkeit: {Array.isArray(match.searcher.personalityTraits) ? match.searcher.personalityTraits.join(', ') : (match.searcher.personalityTraits || 'N/A')}</p>

                                        <h4 className="text-lg font-semibold text-blue-600 mb-2">Passende WG-Angebote:</h4>
                                        <div className="space-y-4">
                                            {match.matchingWGs.length === 0 ? (
                                                <p className="text-gray-600 text-sm">Keine passenden WGs.</p>
                                            ) : (
                                                match.matchingWGs.map(wgMatch => (
                                                    <div key={wgMatch.wg.id} className="bg-white p-4 rounded-lg shadow border border-blue-100">
                                                        <p className="font-bold text-gray-800">WG-Name: {wgMatch.wg.name} (Score: {wgMatch.score}) (ID: {wgMatch.wg.id.substring(0, 8)}...)</p>
                                                        <p className="text-sm text-gray-600">Gesuchtes Alter: {wgMatch.wg.minAge}-{wgMatch.wg.maxAge}, Geschlechtspräferenz: {wgMatch.wg.genderPreference}</p>
                                                        <p className="text-sm text-gray-600">Interessen: {Array.isArray(wgMatch.wg.interests) ? wgMatch.wg.interests.join(', ') : (wgMatch.wg.interests || 'N/A')}</p>
                                                        <p className="text-sm text-gray-600">Persönlichkeit der Bewohner: {Array.isArray(wgMatch.wg.personalityTraits) ? wgMatch.wg.personalityTraits.join(', ') : (wgMatch.wg.personalityTraits || 'N/A')}</p>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="w-full max-w-6xl bg-white p-8 rounded-xl shadow-2xl mt-8">
                        <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Matches: WG findet Suchenden (Admin-Ansicht)</h2>
                        {reverseMatches.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg">Keine Matches gefunden.</p>
                        ) : (
                            <div className="space-y-8">
                                {reverseMatches.map((wgMatch, index) => (
                                    <div key={index} className="bg-green-50 p-6 rounded-lg shadow-inner border border-green-200">
                                        <h3 className="text-xl font-semibold text-green-700 mb-3">
                                            WG-Name: <span className="font-bold">{wgMatch.wg.name}</span> (ID: {wgMatch.wg.id.substring(0, 8)}...)
                                        </h3>
                                        <p className="text-gray-700 mb-2">Gesuchtes Alter: {wgMatch.wg.minAge}-{wgMatch.wg.maxAge}, Geschlechtspräferenz: {wgMatch.wg.genderPreference}</p>
                                        <p className="text-gray-700 mb-4">Interessen: {Array.isArray(wgMatch.wg.interests) ? wgMatch.wg.interests.join(', ') : (wgMatch.wg.interests || 'N/A')}</p>
                                        <p className="text-gray-700 mb-4">Persönlichkeit der Bewohner: {Array.isArray(wgMatch.wg.personalityTraits) ? wgMatch.wg.personalityTraits.join(', ') : (wgMatch.wg.personalityTraits || 'N/A')}</p>

                                        <h4 className="text-lg font-semibold text-green-600 mb-2">Passende Suchende:</h4>
                                        <div className="space-y-4">
                                            {wgMatch.matchingSeekers.length === 0 ? (
                                                <p className="text-gray-600 text-sm">Keine passenden Suchenden.</p>
                                            ) : (
                                                wgMatch.matchingSeekers.map(seekerMatch => (
                                                    <div key={seekerMatch.searcher.id} className="bg-white p-4 rounded-lg shadow border border-green-100">
                                                        <p className="font-bold text-gray-800">Suchender: {seekerMatch.searcher.name} (Score: {seekerMatch.score}) (ID: {seekerMatch.searcher.id.substring(0, 8)}...)</p>
                                                        <p className="text-sm text-gray-600">Alter: {seekerMatch.searcher.age}, Geschlecht: {seekerMatch.searcher.gender}</p>
                                                        <p className="text-sm text-gray-600">Interessen: {Array.isArray(seekerMatch.searcher.interests) ? seekerMatch.searcher.interests.join(', ') : (seekerMatch.searcher.interests || 'N/A')}</p>
                                                        <p className="text-sm text-gray-600">Persönlichkeit: {Array.isArray(seekerMatch.searcher.personalityTraits) ? seekerMatch.searcher.personalityTraits.join(', ') : (seekerMatch.searcher.personalityTraits || 'N/A')}</p>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="w-full max-w-6xl mt-12 bg-white p-8 rounded-xl shadow-2xl">
                        <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Alle Suchenden-Profile (Admin-Ansicht)</h2>
                        {allSearcherProfilesGlobal.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg">Noch keine Suchenden-Profile vorhanden.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {allSearcherProfilesGlobal.map(profile => (
                                    <div key={profile.id} className="bg-purple-50 p-5 rounded-lg shadow-inner border border-purple-200 flex flex-col">
                                        <p className="font-semibold text-purple-700">Name: {profile.name}</p>
                                        <p className="text-sm text-gray-600">Alter: {profile.age}</p>
                                        <p className="text-sm text-gray-600">Geschlecht: {profile.gender}</p>
                                        <p className="text-sm text-gray-600">Interessen: {Array.isArray(profile.interests) ? profile.interests.join(', ') : (profile.interests || 'N/A')}</p>
                                        <p className="text-sm text-gray-600">Persönlichkeit: {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.join(', ') : (profile.personalityTraits || 'N/A')}</p>
                                        <p className="text-xs text-gray-500 mt-2">Erstellt von: {profile.createdBy.substring(0, 8)}...</p>
                                        <p className="text-xs text-gray-500">Am: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                                        <button
                                            onClick={() => handleDeleteProfile('searcherProfiles', profile.id, profile.name, profile.createdBy)}
                                            className="mt-4 px-4 py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out self-end"
                                        >
                                            Löschen
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="w-full max-w-6xl mt-8 bg-white p-8 rounded-xl shadow-2xl">
                        <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Alle WG-Angebote (Admin-Ansicht)</h2>
                        {allWgProfilesGlobal.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg">Noch keine WG-Angebote vorhanden.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {allWgProfilesGlobal.map(profile => (
                                    <div key={profile.id} className="bg-green-50 p-5 rounded-lg shadow-inner border border-green-200 flex flex-col">
                                        <p className="font-semibold text-green-700">WG-Name: {profile.name}</p>
                                        <p className="text-sm text-gray-600">Gesuchtes Alter: {profile.minAge}-{profile.maxAge}</p>
                                        <p className="text-sm text-gray-600">Geschlechtspräferenz: {profile.genderPreference}</p>
                                        <p className="text-sm text-gray-600">Interessen: {Array.isArray(profile.interests) ? profile.interests.join(', ') : (profile.interests || 'N/A')}</p>
                                        <p className="text-sm text-gray-600">Persönlichkeit der Bewohner: {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.join(', ') : (profile.personalityTraits || 'N/A')}</p>
                                        <p className="text-xs text-gray-500 mt-2">Erstellt von: {profile.createdBy.substring(0, 8)}...</p>
                                        <p className="text-xs text-gray-500">Am: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                                        <button
                                            onClick={() => handleDeleteProfile('wgProfiles', profile.id, profile.name, profile.createdBy)}
                                            className="mt-4 px-4 py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out self-end"
                                        >
                                            Löschen
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Seeker Dashboard (for normal user) */}
            {showMySeekerDashboard && (
                <div className="w-full max-w-6xl bg-white p-8 rounded-xl shadow-2xl">
                    <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Meine Matches: Suchender findet WG</h2>
                    {matches.filter(match => match.searcher.createdBy === userId).length === 0 ? (
                        <p className="text-center text-gray-600 text-lg">
                            Sie haben noch keine Suchenden-Profile erstellt oder es wurden keine Matches gefunden.
                        </p>
                    ) : (
                        <div className="space-y-8">
                            {matches
                                .filter(match => match.searcher.createdBy === userId) // Only show matches for own seeker profiles
                                .map((match, index) => (
                                    <div key={index} className="bg-blue-50 p-6 rounded-lg shadow-inner border border-blue-200">
                                        <h3 className="text-xl font-semibold text-blue-700 mb-3">
                                            Ihr Profil: <span className="font-bold">{match.searcher.name}</span>
                                        </h3>
                                        <h4 className="text-lg font-semibold text-blue-600 mb-2">Passende WG-Angebote:</h4>
                                        <div className="space-y-4">
                                            {match.matchingWGs.length === 0 ? (
                                                <p className="text-gray-600 text-sm">Keine passenden WGs zu Ihrem Profil.</p>
                                            ) : (
                                                match.matchingWGs.map(wgMatch => (
                                                    <div key={wgMatch.wg.id} className="bg-white p-4 rounded-lg shadow border border-blue-100">
                                                        <p className="font-bold text-gray-800">WG-Name: {wgMatch.wg.name} (Score: {wgMatch.score})</p>
                                                        <p className="text-sm text-gray-600">Gesuchtes Alter: {wgMatch.wg.minAge}-{wgMatch.wg.maxAge}, Geschlechtspräferenz: {wgMatch.wg.genderPreference}</p>
                                                        <p className="text-sm text-gray-600">Interessen: {Array.isArray(wgMatch.wg.interests) ? wgMatch.wg.interests.join(', ') : (wgMatch.wg.interests || 'N/A')}</p>
                                                        <p className="text-sm text-gray-600">Persönlichkeit der Bewohner: {Array.isArray(wgMatch.wg.personalityTraits) ? wgMatch.wg.personalityTraits.join(', ') : (wgMatch.wg.personalityTraits || 'N/A')}</p>
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

            {/* WG Dashboard (for normal user) */}
            {showMyWgDashboard && (
                <div className="w-full max-w-6xl bg-white p-8 rounded-xl shadow-2xl mt-8">
                    <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Meine Matches: WG findet Suchenden</h2>
                    {reverseMatches.filter(wgMatch => wgMatch.wg.createdBy === userId).length === 0 ? (
                        <p className="text-center text-gray-600 text-lg">
                            Sie haben noch keine WG-Angebote erstellt oder es wurden keine Matches gefunden.
                        </p>
                    ) : (
                        <div className="space-y-8">
                            {reverseMatches
                                .filter(wgMatch => wgMatch.wg.createdBy === userId) // Only show matches for own flatshare profiles
                                .map((wgMatch, index) => (
                                    <div key={index} className="bg-green-50 p-6 rounded-lg shadow-inner border border-green-200">
                                        <h3 className="text-xl font-semibold text-green-700 mb-3">
                                            Ihr WG-Profil: <span className="font-bold">{wgMatch.wg.name}</span>
                                        </h3>
                                        <h4 className="text-lg font-semibold text-green-600 mb-2">Passende Suchende:</h4>
                                        <div className="space-y-4">
                                            {wgMatch.matchingSeekers.length === 0 ? (
                                                <p className="text-gray-600 text-sm">Keine passenden Suchenden zu Ihrem WG-Profil.</p>
                                            ) : (
                                                wgMatch.matchingSeekers.map(seekerMatch => (
                                                    <div key={seekerMatch.searcher.id} className="bg-white p-4 rounded-lg shadow border border-green-100">
                                                        <p className="font-bold text-gray-800">Suchender: {seekerMatch.searcher.name} (Score: {seekerMatch.score})</p>
                                                        <p className="text-sm text-gray-600">Alter: {seekerMatch.searcher.age}, Geschlecht: {seekerMatch.searcher.gender}</p>
                                                        <p className="text-sm text-gray-600">Interessen: {Array.isArray(seekerMatch.searcher.interests) ? seekerMatch.searcher.interests.join(', ') : (seekerMatch.searcher.interests || 'N/A')}</p>
                                                        <p className="text-sm text-gray-600">Persönlichkeit: {Array.isArray(seekerMatch.searcher.personalityTraits) ? seekerMatch.searcher.personalityTraits.join(', ') : (seekerMatch.searcher.personalityTraits || 'N/A')}</p>
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
    );
}

export default App;