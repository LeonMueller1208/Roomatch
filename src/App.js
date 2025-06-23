import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc } from 'firebase/firestore';
import { Search, Users, Heart, Trash2, User, Home as HomeIcon, CheckCircle, XCircle } from 'lucide-react';

// Firebase-Konfiguration
const firebaseConfig = {
    // ERSETZE DIESEN API-KEY MIT DEINEM EIGENEN AUS DER FIREBASE-KONSOLE!
    apiKey: "AIzaSyACGoSxD0_UZhWg06gzZjaifBn3sI06YGg", // Beispiel: "AIzaSyACGoSxD0_UZWNg06gzZjaifBn3sI06YGg"
    authDomain: "mvp-roomatch.firebaseapp.com",
    projectId: "mvp-roomatch",
    storageBucket: "mvp-roomatch.firebasestorage.app",
    messagingSenderId: "190918526277",
    appId: "1:190918526277:web:268e07e2f1f326b8e86a2c",
    measurementId: "G-5JPWLD0ZC"
};

// Vordefinierte Listen für Persönlichkeitsmerkmale und Interessen
const allPersonalityTraits = ['ordentlich', 'ruhig', 'gesellig', 'kreativ', 'sportlich', 'nachtaktiv', 'frühaufsteher', 'tolerant', 'tierlieb', 'flexibel', 'strukturiert'];
const allInterests = ['Kochen', 'Filme', 'Musik', 'Spiele', 'Natur', 'Sport', 'Lesen', 'Reisen', 'Feiern', 'Gaming', 'Pflanzen', 'Kultur', 'Kunst'];
const allCommunalLivingPreferences = ['sehr ordentlich', 'eher entspannt', 'wöchentliche Putzpläne bevorzugt', 'spontanes Aufräumen', 'oft zusammen kochen', 'manchmal zusammen kochen', 'selten zusammen kochen'];
const allWGValues = ['Nachhaltigkeit wichtig', 'offene Kommunikation bevorzugt', 'Respekt vor Privatsphäre', 'gemeinsame Aktivitäten wichtig', 'ruhiges Zuhause bevorzugt', 'lebhaftes Zuhause bevorzugt', 'politisch engagiert', 'kulturell interessiert'];


// **WICHTIG:** ERSETZE DIESEN WERT EXAKT MIT DEINER ADMIN-ID, DIE IN DER APP ANGEZEIGT WIRD!
const ADMIN_UID = "H9jtz5aHKkcN7JCjtTPL7t32rtE3"; 

// Funktion zur Berechnung des Match-Scores zwischen einem Suchenden und einem WG-Profil
const calculateMatchScore = (seeker, wg) => {
    let score = 0;

    const getArrayValue = (profile, field) => {
        const value = profile[field];
        return Array.isArray(value) ? value : (value ? String(value).split(',').map(s => s.trim()) : []);
    };

    // 1. Alter Match (Suchender-Alter vs. WG-Altersbereich)
    if (seeker.age && wg.minAge && wg.maxAge) {
        if (seeker.age >= wg.minAge && seeker.age <= wg.maxAge) {
            score += 20;
        } else {
            score -= 15;
        }
    }

    // 2. Geschlechtspräferenz
    if (seeker.gender && wg.genderPreference) {
        if (wg.genderPreference === 'egal' || seeker.gender === wg.genderPreference) {
            score += 10;
        } else {
            score -= 10;
        }
    }

    // 3. Persönlichkeitsmerkmale (Übereinstimmung)
    const seekerTraits = getArrayValue(seeker, 'personalityTraits');
    const wgTraits = getArrayValue(wg, 'personalityTraits');
    seekerTraits.forEach(trait => {
        if (wgTraits.includes(trait)) {
            score += 5;
        }
    });

    // 4. Interessen (Überlappung)
    const seekerInterests = getArrayValue(seeker, 'interests');
    const wgInterests = getArrayValue(wg, 'interests');
    seekerInterests.forEach(interest => {
        if (wgInterests.includes(interest)) {
            score += 3;
        }
    });

    // 5. Mietpreis (Suchender Max. Miete >= WG Miete)
    if (seeker.maxRent && wg.rent) {
        if (seeker.maxRent >= wg.rent) {
            score += 15;
        } else {
            score -= 15;
        }
    }

    // 6. Haustiere (Match)
    if (seeker.pets && wg.petsAllowed) {
        if (seeker.pets === 'ja' && wg.petsAllowed === 'ja') {
            score += 8;
        } else if (seeker.pets === 'ja' && wg.petsAllowed === 'nein') {
            score -= 8;
        }
    }

    // 7. Freitext 'lookingFor' (Suchender) vs. 'description'/'lookingForInFlatmate' (WG)
    const seekerLookingFor = (seeker.lookingFor || '').toLowerCase();
    const wgDescription = (wg.description || '').toLowerCase();
    const wgLookingForInFlatmate = (wg.lookingForInFlatmate || '').toLowerCase();

    const seekerKeywords = seekerLookingFor.split(' ').filter(word => word.length > 2);
    seekerKeywords.forEach(keyword => {
        if (wgDescription.includes(keyword) || wgLookingForInFlatmate.includes(keyword)) {
            score += 1;
        }
    });

    // 8. Durchschnittsalter der WG-Bewohner im Vergleich zum Suchendenalter
    if (seeker.age && wg.avgAge) {
        score -= Math.abs(seeker.age - wg.avgAge);
    }

    // 9. Neue: Präferenzen zum Zusammenleben (Communal Living Preferences)
    const seekerCommunalPrefs = getArrayValue(seeker, 'communalLivingPreferences');
    const wgCommunalPrefs = getArrayValue(wg, 'wgCommunalLiving');
    seekerCommunalPrefs.forEach(pref => {
        if (wgCommunalPrefs.includes(pref)) {
            score += 7; // Hoher Wert für Übereinstimmung bei Lebensgewohnheiten
        }
    });

    // 10. Neue: Werte (Values)
    const seekerValues = getArrayValue(seeker, 'values');
    const wgValues = getArrayValue(wg, 'wgValues');
    seekerValues.forEach(val => {
        if (wgValues.includes(val)) {
            score += 10; // Sehr hoher Wert für Übereinstimmung bei Werten
        }
    });

    return score;
};


// Hauptkomponente der WG-Match-Anwendung
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
    const [showSeekerForm, setShowSeekerForm] = useState(true); // Standardmäßig Suchenden-Formular anzeigen
    const [saveMessage, setSaveMessage] = useState('');
    const [adminMode, setAdminMode] = useState(false);

    // Firebase-Initialisierung und Authentifizierung
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
                        console.error("Fehler bei der Firebase-Anonym-Authentifizierung:", signInError);
                        setError("Fehler bei der Anmeldung. Bitte versuchen Sie es später erneut.");
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
            console.error("Fehler bei der Firebase-Initialisierung:", initError);
            setError("Firebase konnte nicht initialisiert werden. Bitte überprüfen Sie Ihre Firebase-Konfiguration und Internetverbindung.");
            setLoading(false);
        }
    }, []);

    // Wenn der Admin-Modus umgeschaltet wird, stelle sicher, dass das Formular standardmäßig auf 'Suchenden-Profil' zurückgesetzt wird
    useEffect(() => {
        if (!adminMode) {
            setShowSeekerForm(true); // Setzt es auf Suchenden-Formular, wenn Admin-Modus deaktiviert ist
        }
    }, [adminMode]);


    // Echtzeit-Datenabruf für *eigene* Suchende-Profile von Firestore
    useEffect(() => {
        if (!db || !userId) return;
        // Aktualisierter Pfad für öffentliche Daten, wenn Sie die Firestore-Sicherheitsregeln auf "public" ändern.
        // Wenn Sie private Daten nach Benutzer-ID speichern wollen, wäre der Pfad `users/${userId}/searcherProfiles`
        const mySearchersQuery = query(collection(db, `searcherProfiles`), where('createdBy', '==', userId));
        const unsubscribeMySearchers = onSnapshot(mySearchersQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMySearcherProfiles(profiles);
        }, (err) => {
            console.error("Fehler beim Abrufen der eigenen Suchenden-Profile:", err);
            setError("Fehler beim Laden der eigenen Suchenden-Profile.");
        });
        return () => unsubscribeMySearchers();
    }, [db, userId]);

    // Echtzeit-Datenabruf für *eigene* WG-Profile von Firestore
    useEffect(() => {
        if (!db || !userId) return;
        const myWgsQuery = query(collection(db, `wgProfiles`), where('createdBy', '==', userId));
        const unsubscribeMyWGs = onSnapshot(myWgsQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMyWgProfiles(profiles);
        }, (err) => {
            console.error("Fehler beim Abrufen der eigenen WG-Profile:", err);
            setError("Fehler beim Laden der eigenen WG-Profile.");
        });
        return () => unsubscribeMyWGs();
    }, [db, userId]);

    // Echtzeit-Datenabruf für *alle* Suchende-Profile (für Match-Berechnung)
    useEffect(() => {
        if (!db) return;
        const allSearchersQuery = query(collection(db, `searcherProfiles`));
        const unsubscribeAllSearchers = onSnapshot(allSearchersQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAllSearcherProfilesGlobal(profiles);
        }, (err) => {
            console.error("Fehler beim Abrufen aller Suchenden-Profile (global):", err);
        });
        return () => unsubscribeAllSearchers();
    }, [db]);

    // Echtzeit-Datenabruf für *alle* WG-Profile (für Match-Berechnung)
    useEffect(() => {
        if (!db) return;
        const allWgsQuery = query(collection(db, `wgProfiles`));
        const unsubscribeAllWGs = onSnapshot(allWgsQuery, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAllWgProfilesGlobal(profiles);
        }, (err) => {
            console.error("Fehler beim Abrufen aller WG-Profile (global):", err);
        });
        return () => unsubscribeAllWGs();
    }, [db]);

    // Match-Berechnung für beide Richtungen
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


    // Funktion zum Hinzufügen eines Suchenden-Profils zu Firestore
    const addSearcherProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Datenbank nicht bereit. Bitte warten Sie oder melden Sie sich an.");
            return;
        }
        try {
            await addDoc(collection(db, `searcherProfiles`), {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId,
            });
            setSaveMessage('Suchenden-Profil erfolgreich gespeichert!');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e) {
            console.error("Fehler beim Hinzufügen des Suchenden-Profils: ", e);
            setError("Fehler beim Speichern des Suchenden-Profils.");
        }
    };

    // Funktion zum Hinzufügen eines WG-Profils zu Firestore
    const addWGProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Datenbank nicht bereit. Bitte warten Sie oder melden Sie sich an.");
            return;
        }
        try {
            await addDoc(collection(db, `wgProfiles`), {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId,
            });
            setSaveMessage('WG-Profil erfolgreich gespeichert!');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e) {
            console.error("Fehler beim Hinzufügen des WG-Profils: ", e);
            setError("Fehler beim Speichern des WG-Profils.");
        }
    };

    // Funktion zum Löschen eines Profils
    const handleDeleteProfile = async (collectionName, docId, profileName, profileCreatorId) => {
        if (!db || !userId) {
            setError("Datenbank nicht bereit zum Löschen.");
            return;
        }

        // Überprüfen der Berechtigung vor dem Löschen
        if (!adminMode && userId !== profileCreatorId) {
            setError("Sie sind nicht berechtigt, dieses Profil zu löschen.");
            setTimeout(() => setError(''), 3000); // Nachricht nach 3 Sekunden ausblenden
            return;
        }

        // Direkte Löschung ohne Bestätigungsdialog (gemäß Anweisung)
        try {
            await deleteDoc(doc(db, collectionName, docId));
            setSaveMessage(`Profil "${profileName}" erfolgreich gelöscht!`);
            setTimeout(() => setSaveMessage(''), 3000); // Nachricht nach 3 Sekunden ausblenden
        } catch (e) {
            console.error(`Fehler beim Löschen des Profils ${profileName}: `, e);
            setError(`Fehler beim Löschen von Profil "${profileName}".`);
        }
    };

    // Vereinheitlichte Profilformular-Komponente
    const ProfileForm = ({ onSubmit, type }) => {
        const [currentStep, setCurrentStep] = useState(1);
        const totalSteps = 3; // Hier ist die Anzahl der Schritte definiert

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
            communalLivingPreferences: [], // Neu für Suchende
            wgCommunalLiving: [],          // Neu für Anbieter
            values: [],                    // Neu für Suchende
            wgValues: [],                  // Neu für Anbieter
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
            setFormState({ // Formular vollständig zurücksetzen
                name: '', age: '', minAge: '', maxAge: '', gender: 'männlich',
                genderPreference: 'egal', personalityTraits: [], interests: [],
                maxRent: '', pets: 'egal', lookingFor: '', description: '', rent: '',
                roomType: 'Einzelzimmer', petsAllowed: 'egal', avgAge: '',
                lookingForInFlatmate: '', location: '',
                communalLivingPreferences: [], wgCommunalLiving: [], values: [], wgValues: []
            });
            setCurrentStep(1); // Zurück zum ersten Schritt
            // Optional: Wenn das Formular von der Hauptseite aus geöffnet wird, könnte man auch zur Hauptseite zurückkehren:
            // setShowSeekerForm(true); // Oder eine andere Logik, die dich zur Hauptansicht bringt
        };


        const handleSubmit = (e) => {
            e.preventDefault(); // Verhindert die Standard-Formularübermittlung des Browsers

            if (currentStep === totalSteps) { // Formular wird nur im letzten Schritt abgeschickt
                const dataToSubmit = { ...formState };
                if (dataToSubmit.age) dataToSubmit.age = parseInt(dataToSubmit.age); 
                if (dataToSubmit.minAge) dataToSubmit.minAge = parseInt(dataToSubmit.minAge);
                if (dataToSubmit.maxAge) dataToSubmit.maxAge = parseInt(dataToSubmit.maxAge);
                if (dataToSubmit.maxRent) dataToSubmit.maxRent = parseInt(dataToSubmit.maxRent);
                if (dataToSubmit.rent) dataToSubmit.rent = parseInt(dataToSubmit.rent);
                if (dataToSubmit.avgAge) dataToSubmit.avgAge = parseInt(dataToSubmit.avgAge);

                onSubmit(dataToSubmit);
                setFormState({ // Formular zurücksetzen nach dem Speichern
                    name: '', age: '', minAge: '', maxAge: '', gender: 'männlich',
                    genderPreference: 'egal', personalityTraits: [], interests: [],
                    maxRent: '', pets: 'egal', lookingFor: '', description: '', rent: '',
                    roomType: 'Einzelzimmer', petsAllowed: 'egal', avgAge: '',
                    lookingForInFlatmate: '', location: '',
                    communalLivingPreferences: [], wgCommunalLiving: [], values: [], wgValues: []
                });
                setCurrentStep(1); // Zurück zum ersten Schritt
            } else {
                nextStep(); // Gehe zum nächsten Schritt
            }
        };

        return (
            <form onSubmit={handleSubmit} className="p-8 bg-white rounded-2xl shadow-xl space-y-6 w-full max-w-xl mx-auto transform transition-all duration-300 hover:scale-[1.01]">
                <h2 className="text-3xl font-extrabold text-gray-800 mb-6 text-center">
                    {type === 'seeker' ? `Suchenden-Profil erstellen (Schritt ${currentStep}/${totalSteps})` : `WG-Angebot erstellen (Schritt ${currentStep}/${totalSteps})`}
                </h2>

                {/* --- SCHRITT 1 --- */}
                {currentStep === 1 && (
                    <div className="space-y-4">
                        {/* Name / WG-Name */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">
                                {type === 'seeker' ? 'Dein Name:' : 'Name der WG:'}
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

                        {/* Alter (Suchender) / Altersbereich (Anbieter) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Dein Alter:</label>
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
                                    <label className="block text-gray-700 text-base font-semibold mb-2">Mindestalter Mitbewohner:</label>
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
                                    <label className="block text-gray-700 text-base font-semibold mb-2">Höchstalter Mitbewohner:</label>
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

                        {/* Geschlecht (Suchender) / Geschlechtspräferenz (Anbieter) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Dein Geschlecht:</label>
                                <select
                                    name="gender"
                                    value={formState.gender}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                >
                                    <option value="männlich">Männlich</option>
                                    <option value="weiblich">Weiblich</option>
                                    <option value="divers">Divers</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Geschlechtspräferenz Mitbewohner:</label>
                                <select
                                    name="genderPreference"
                                    value={formState.genderPreference}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                >
                                    <option value="egal">Egal</option>
                                    <option value="männlich">Männlich</option>
                                    <option value="weiblich">Weiblich</option>
                                    <option value="divers">Divers</option>
                                </select>
                            </div>
                        )}

                        {/* Ort/Stadtteil (für beide) */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">Ort / Stadtteil:</label>
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

                {/* --- SCHRITT 2 --- */}
                {currentStep === 2 && (
                    <div className="space-y-4">
                        {/* Maximale Miete (Suchender) / Miete (Anbieter) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Maximale Miete (€):</label>
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
                                <label className="block text-gray-700 text-base font-semibold mb-2">Miete (€):</label>
                                <input
                                    type="number"
                                    name="rent"
                                    value={formState.rent}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                />
                            </div>
                        )}

                        {/* Haustiere (Suchender) / Haustiere erlaubt (Anbieter) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Haustiere:</label>
                                <select
                                    name="pets"
                                    value={formState.pets}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                >
                                    <option value="egal">Egal</option>
                                    <option value="ja">Ja</option>
                                    <option value="nein">Nein</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Haustiere erlaubt:</label>
                                <select
                                    name="petsAllowed"
                                    value={formState.petsAllowed}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                >
                                    <option value="egal">Egal</option>
                                    <option value="ja">Ja</option>
                                    <option value="nein">Nein</option>
                                </select>
                            </div>
                        )}

                        {/* Persönlichkeitsmerkmale (für beide) */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">
                                {type === 'seeker' ? 'Deine Persönlichkeitsmerkmale:' : 'Persönlichkeitsmerkmale der aktuellen Bewohner:'}
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

                        {/* Interessen (für beide) */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">
                                {type === 'seeker' ? 'Deine Interessen:' : 'Interessen der aktuellen Bewohner:'}
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

                        {/* Neue: Präferenzen zum WG-Leben (Communal Living Preferences) */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">
                                {type === 'seeker' ? 'Deine Präferenzen zum WG-Leben:' : 'Präferenzen der WG zum Zusammenleben:'}
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

                {/* --- SCHRITT 3 --- */}
                {currentStep === 3 && (
                    <div className="space-y-4">
                        {/* Was gesucht wird (Suchender) / Beschreibung der WG (Anbieter) */}
                        {type === 'seeker' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Was suchst du in einer WG?:</label>
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
                                    <label className="block text-gray-700 text-base font-semibold mb-2">Beschreibung der WG:</label>
                                    <textarea
                                        name="description"
                                        value={formState.description}
                                        onChange={handleChange}
                                        rows="3"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                    ></textarea>
                                </div>
                                <div>
                                    <label className="block text-gray-700 text-base font-semibold mb-2">Was sucht ihr im neuen Mitbewohner?:</label>
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
                                <label className="block text-gray-700 text-base font-semibold mb-2">Zimmertyp:</label>
                                <select
                                    name="roomType"
                                    value={formState.roomType}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                >
                                    <option value="Einzelzimmer">Einzelzimmer</option>
                                    <option value="Doppelzimmer">Doppelzimmer</option>
                                </select>
                            </div>
                        )}
                        {type === 'provider' && (
                            <div>
                                <label className="block text-gray-700 text-base font-semibold mb-2">Durchschnittsalter der Bewohner:</label>
                                <input
                                    type="number"
                                    name="avgAge"
                                    value={formState.avgAge}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3fd5c1] transition-all duration-200"
                                />
                            </div>
                        )}

                        {/* Neue: Werte (Values) */}
                        <div>
                            <label className="block text-gray-700 text-base font-semibold mb-2">
                                {type === 'seeker' ? 'Deine Werte und Erwartungen an das WG-Leben:' : 'Werte und Erwartungen der WG:'}
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
                        <XCircle size={20} className="mr-2" /> Abbrechen
                    </button>
                    {currentStep > 1 && (
                        <button
                            type="button"
                            onClick={prevStep}
                            className="flex items-center px-6 py-3 bg-gray-300 text-gray-800 font-bold rounded-xl shadow-md hover:bg-gray-400 transition duration-150 ease-in-out transform hover:-translate-y-0.5"
                        >
                            Zurück
                        </button>
                    )}
                    {currentStep < totalSteps ? (
                        <button
                            type="button"
                            onClick={nextStep}
                            className="flex items-center px-6 py-3 bg-[#3fd5c1] text-white font-bold rounded-xl shadow-lg hover:bg-[#32c0ae] transition duration-150 ease-in-out transform hover:-translate-y-0.5"
                        >
                            Weiter
                        </button>
                    ) : (
                        <button
                            type="submit"
                            className={`flex items-center px-6 py-3 font-bold rounded-xl shadow-lg transition duration-150 ease-in-out transform hover:-translate-y-0.5 ${
                                type === 'seeker'
                                    ? 'bg-[#9adfaa] hover:bg-[#85c292] text-[#333333]'
                                    : 'bg-[#fecd82] hover:bg-[#e6b772] text-[#333333]'
                            }`}
                        >
                            <CheckCircle size={20} className="mr-2" /> Profil speichern
                        </button>
                    )}
                </div>
            </form>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#3fd5c1] to-[#e0f7f4]">
                <p className="text-gray-700 text-lg animate-pulse">Lade App und Daten...</p>
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
    const showMyWgDashboard = myWgProfiles.length > 0 && !adminMode;

    return (
        <div className="min-h-screen bg-[#3fd5c1] p-8 font-inter flex flex-col items-center relative overflow-hidden">
            {/* Hintergrund-Kreise für visuelle Dynamik */}
            <div className="absolute top-[-50px] left-[-50px] w-48 h-48 bg-white opacity-10 rounded-full animate-blob-slow"></div>
            <div className="absolute bottom-[-50px] right-[-50px] w-64 h-64 bg-white opacity-10 rounded-full animate-blob-medium"></div>
            <div className="absolute top-1/3 right-1/4 w-32 h-32 bg-white opacity-10 rounded-full animate-blob-fast"></div>


            <h1 className="text-5xl font-extrabold text-white mb-8 text-center drop-shadow-lg">Roomatch</h1>
            
            {userId && (
                <div className="bg-[#c3efe8] text-[#0a665a] text-sm px-6 py-3 rounded-full mb-8 shadow-md flex items-center transform transition-all duration-300 hover:scale-[1.02]">
                    <User size={18} className="mr-2" /> Ihre Benutzer-ID: <span className="font-mono font-semibold ml-1">{userId}</span>
                    {userId === ADMIN_UID && (
                        <label className="ml-6 inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="form-checkbox h-5 w-5 text-[#3fd5c1] rounded-md transition-all duration-200 focus:ring-2 focus:ring-[#3fd5c1]"
                                checked={adminMode}
                                onChange={() => setAdminMode(!adminMode)}
                            />
                            <span className="ml-2 text-[#0a665a] font-bold select-none">Admin-Modus</span>
                        </label>
                    )}
                </div>
            )}
            {saveMessage && (
                <div className="bg-green-100 text-green-700 px-5 py-3 rounded-lg mb-6 shadow-xl transition-all duration-300 scale-100 animate-fade-in-down">
                    {saveMessage}
                </div>
            )}

            {/* --- HAUPTANSICHTEN (Admin-Modus vs. Normaler Modus) --- */}
            {adminMode ? (
                // ADMIN-MODUS AN: Zeige alle Admin-Dashboards
                <div className="w-full max-w-7xl flex flex-col gap-12">
                    <div className="bg-white p-10 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl">
                        <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">Matches: Suchender findet WG (Admin-Ansicht)</h2>
                        {matches.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg py-4">Keine Matches gefunden.</p>
                        ) : (
                            <div className="space-y-8">
                                {matches.map((match, index) => (
                                    <div key={index} className="bg-[#f0f8f0] p-8 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                        <h3 className="text-2xl font-bold text-[#333333] mb-4 flex items-center">
                                            <Search size={22} className="mr-3 text-[#5a9c68]" /> Suchender: <span className="font-extrabold ml-2">{match.searcher.name}</span> (ID: {match.searcher.id.substring(0, 8)}...)
                                        </h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-gray-700 text-base mb-6">
                                            <p><span className="font-semibold">Alter:</span> {match.searcher.age}</p>
                                            <p><span className="font-semibold">Geschlecht:</span> {match.searcher.gender}</p>
                                            <p><span className="font-semibold">Interessen:</span> {Array.isArray(match.searcher.interests) ? match.searcher.interests.join(', ') : (match.searcher.interests || 'N/A')}</p>
                                            <p><span className="font-semibold">Persönlichkeit:</span> {Array.isArray(match.searcher.personalityTraits) ? match.searcher.personalityTraits.join(', ') : (match.searcher.personalityTraits || 'N/A')}</p>
                                            <p><span className="font-semibold">WG-Präferenzen:</span> {Array.isArray(match.searcher.communalLivingPreferences) ? match.searcher.communalLivingPreferences.join(', ') : (match.searcher.communalLivingPreferences || 'N/A')}</p>
                                            <p><span className="font-semibold">Werte:</span> {Array.isArray(match.searcher.values) ? match.searcher.values.join(', ') : (match.searcher.values || 'N/A')}</p>
                                        </div>

                                        <h4 className="text-xl font-bold text-[#5a9c68] mb-4 flex items-center">
                                            <Heart size={20} className="mr-2" /> Passende WG-Angebote:
                                        </h4>
                                        <div className="space-y-4">
                                            {match.matchingWGs.length === 0 ? (
                                                <p className="text-gray-600 text-base">Keine passenden WGs.</p>
                                            ) : (
                                                match.matchingWGs.map(wgMatch => (
                                                    <div key={wgMatch.wg.id} className="bg-white p-5 rounded-lg shadow border border-[#9adfaa] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                        <div>
                                                            <p className="font-bold text-gray-800 text-lg">WG-Name: {wgMatch.wg.name} <span className="text-sm font-normal text-gray-600">(Score: {wgMatch.score})</span></p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Gesuchtes Alter:</span> {wgMatch.wg.minAge}-{wgMatch.wg.maxAge}, <span className="font-medium">Geschlechtspräferenz:</span> {wgMatch.wg.genderPreference}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Interessen:</span> {Array.isArray(wgMatch.wg.interests) ? wgMatch.wg.interests.join(', ') : (wgMatch.wg.interests || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Persönlichkeit der Bewohner:</span> {Array.isArray(wgMatch.wg.personalityTraits) ? wgMatch.wg.personalityTraits.join(', ') : (wgMatch.wg.personalityTraits || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG-Zusammenleben:</span> {Array.isArray(wgMatch.wg.wgCommunalLiving) ? wgMatch.wg.wgCommunalLiving.join(', ') : (wgMatch.wg.wgCommunalLiving || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG-Werte:</span> {Array.isArray(wgMatch.wg.wgValues) ? wgMatch.wg.wgValues.join(', ') : (wgMatch.wg.wgValues || 'N/A')}</p>
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
                        <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">Matches: WG findet Suchenden (Admin-Ansicht)</h2>
                        {reverseMatches.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg py-4">Keine Matches gefunden.</p>
                        ) : (
                            <div className="space-y-8">
                                {reverseMatches.map((wgMatch, index) => (
                                    <div key={index} className="bg-[#fff8f0] p-8 rounded-xl shadow-lg border border-[#fecd82] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                        <h3 className="text-2xl font-bold text-[#333333] mb-4 flex items-center">
                                            <HomeIcon size={22} className="mr-3 text-[#cc8a2f]" /> WG-Name: <span className="font-extrabold ml-2">{wgMatch.wg.name}</span> (ID: {wgMatch.wg.id.substring(0, 8)}...)
                                        </h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-gray-700 text-base mb-6">
                                            <p><span className="font-semibold">Gesuchtes Alter:</span> {wgMatch.wg.minAge}-{wgMatch.wg.maxAge}</p>
                                            <p><span className="font-semibold">Geschlechtspräferenz:</span> {wgMatch.wg.genderPreference}</p>
                                            <p><span className="font-semibold">Interessen:</span> {Array.isArray(wgMatch.wg.interests) ? wgMatch.wg.interests.join(', ') : (wgMatch.wg.interests || 'N/A')}</p>
                                            <p className="text-sm text-gray-600"><span className="font-semibold">Persönlichkeit der Bewohner:</span> {Array.isArray(wgMatch.wg.personalityTraits) ? wgMatch.wg.personalityTraits.join(', ') : (wgMatch.wg.personalityTraits || 'N/A')}</p>
                                            <p className="text-sm text-gray-600"><span className="font-semibold">WG-Zusammenleben:</span> {Array.isArray(wgMatch.wg.wgCommunalLiving) ? wgMatch.wg.wgCommunalLiving.join(', ') : (wgMatch.wg.wgCommunalLiving || 'N/A')}</p>
                                            <p className="text-sm text-gray-600"><span className="font-semibold">WG-Werte:</span> {Array.isArray(wgMatch.wg.wgValues) ? wgMatch.wg.wgValues.join(', ') : (wgMatch.wg.wgValues || 'N/A')}</p>
                                        </div>

                                        <h4 className="text-xl font-bold text-[#cc8a2f] mb-4 flex items-center">
                                            <Users size={20} className="mr-2" /> Passende Suchende:
                                        </h4>
                                        <div className="space-y-4">
                                            {wgMatch.matchingSeekers.length === 0 ? (
                                                <p className="text-gray-600 text-base">Keine passenden Suchenden zu Ihrem WG-Profil.</p>
                                                            ) : (
                                                                wgMatch.matchingSeekers.map(seekerMatch => (
                                                                    <div key={seekerMatch.searcher.id} className="bg-white p-5 rounded-lg shadow border border-[#fecd82] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                        <div>
                                                            <p className="font-bold text-gray-800 text-lg">Suchender: {seekerMatch.searcher.name} <span className="text-sm font-normal text-gray-600">(Score: {seekerMatch.score})</span></p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Alter:</span> {seekerMatch.searcher.age}, <span className="font-medium">Geschlecht:</span> {seekerMatch.searcher.gender}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Interessen:</span> {Array.isArray(seekerMatch.searcher.interests) ? seekerMatch.searcher.interests.join(', ') : (seekerMatch.searcher.interests || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Persönlichkeit:</span> {Array.isArray(seekerMatch.searcher.personalityTraits) ? seekerMatch.searcher.personalityTraits.join(', ') : (seekerMatch.searcher.personalityTraits || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG-Präferenzen:</span> {Array.isArray(seekerMatch.searcher.communalLivingPreferences) ? seekerMatch.searcher.communalLivingPreferences.join(', ') : (seekerMatch.searcher.communalLivingPreferences || 'N/A')}</p>
                                                            <p className="text-sm text-gray-600"><span className="font-medium">Werte:</span> {Array.isArray(seekerMatch.searcher.values) ? seekerMatch.searcher.values.join(', ') : (seekerMatch.searcher.values || 'N/A')}</p>
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
                        <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">Alle Suchenden-Profile (Admin-Ansicht)</h2>
                        {allSearcherProfilesGlobal.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg py-4">Noch keine Suchenden-Profile vorhanden.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {allSearcherProfilesGlobal.map(profile => (
                                    <div key={profile.id} className="bg-[#f0f8f0] p-6 rounded-xl shadow-lg border border-[#9adfaa] flex flex-col transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                        <p className="font-bold text-[#333333] text-lg mb-2">Name: {profile.name}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Alter:</span> {profile.age}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Geschlecht:</span> {profile.gender}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Interessen:</span> {Array.isArray(profile.interests) ? profile.interests.join(', ') : (profile.interests || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Persönlichkeit:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.join(', ') : (profile.personalityTraits || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">WG-Präferenzen:</span> {Array.isArray(profile.communalLivingPreferences) ? profile.communalLivingPreferences.join(', ') : (profile.communalLivingPreferences || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Werte:</span> {Array.isArray(profile.values) ? profile.values.join(', ') : (profile.values || 'N/A')}</p>
                                        <p className="text-xs text-gray-500 mt-4">Erstellt von: {profile.createdBy.substring(0, 8)}...</p>
                                        <p className="text-xs text-gray-500">Am: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                                        <button
                                            onClick={() => handleDeleteProfile('searcherProfiles', profile.id, profile.name, profile.createdBy)}
                                            className="mt-6 px-5 py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out self-end flex items-center transform hover:-translate-y-0.5"
                                        >
                                            <Trash2 size={16} className="mr-2" /> Löschen
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="bg-white p-10 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-12">
                        <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">Alle WG-Angebote (Admin-Ansicht)</h2>
                        {allWgProfilesGlobal.length === 0 ? (
                            <p className="text-center text-gray-600 text-lg py-4">Noch keine WG-Angebote vorhanden.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {allWgProfilesGlobal.map(profile => (
                                    <div key={profile.id} className="bg-[#fff8f0] p-6 rounded-xl shadow-lg border border-[#fecd82] flex flex-col transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                        <p className="font-bold text-[#333333] text-lg mb-2">WG-Name: {profile.name}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Gesuchtes Alter:</span> {profile.minAge}-{profile.maxAge}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Geschlechtspräferenz:</span> {profile.genderPreference}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Interessen:</span> {Array.isArray(profile.interests) ? profile.interests.join(', ') : (profile.interests || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">Persönlichkeit der Bewohner:</span> {Array.isArray(profile.personalityTraits) ? profile.personalityTraits.join(', ') : (profile.personalityTraits || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">WG-Zusammenleben:</span> {Array.isArray(profile.wgCommunalLiving) ? profile.wgCommunalLiving.join(', ') : (profile.wgCommunalLiving || 'N/A')}</p>
                                        <p className="text-sm text-gray-700"><span className="font-semibold">WG-Werte:</span> {Array.isArray(profile.wgValues) ? profile.wgValues.join(', ') : (profile.wgValues || 'N/A')}</p>
                                        <p className="text-xs text-gray-500 mt-4">Erstellt von: {profile.createdBy.substring(0, 8)}...</p>
                                        <p className="text-xs text-gray-500">Am: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                                        <button
                                            onClick={() => handleDeleteProfile('wgProfiles', profile.id, profile.name, profile.createdBy)}
                                            className="mt-6 px-5 py-2 bg-red-500 text-white font-bold rounded-lg shadow-md hover:bg-red-600 transition duration-150 ease-in-out self-end flex items-center transform hover:-translate-y-0.5"
                                        >
                                            <Trash2 size={16} className="mr-2" /> Löschen
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                // NORMALER MODUS: Zeige Formularauswahl + Formulare und dann Dashboards (falls vorhanden)
                <div className="w-full max-w-7xl flex flex-col gap-12">
                    {/* Formularauswahl-Buttons */}
                    <div className="w-full max-w-4xl flex flex-col sm:flex-row justify-center space-y-4 sm:space-y-0 sm:space-x-6 mb-12 mx-auto">
                        <button
                            onClick={() => setShowSeekerForm(true)}
                            className={`flex items-center justify-center px-8 py-4 rounded-xl text-xl font-semibold shadow-xl transition-all duration-300 transform hover:scale-105 hover:shadow-2xl ${
                                showSeekerForm
                                    ? 'bg-[#9adfaa] text-[#333333]'
                                    : 'bg-white text-[#9adfaa] hover:bg-gray-50'
                            }`}
                        >
                            <Search size={24} className="mr-3" /> Suchenden-Profil
                        </button>
                        <button
                            onClick={() => setShowSeekerForm(false)}
                            className={`flex items-center justify-center px-8 py-4 rounded-xl text-xl font-semibold shadow-xl transition-all duration-300 transform hover:scale-105 hover:shadow-2xl ${
                                !showSeekerForm
                                    ? 'bg-[#fecd82] text-[#333333]'
                                    : 'bg-white text-[#fecd82] hover:bg-gray-50'
                            }`}
                        >
                            <HomeIcon size={24} className="mr-3" /> WG-Angebot
                        </button>
                    </div>

                    {/* Aktuelles Formular */}
                    <div className="w-full max-w-xl mb-12 mx-auto">
                        <ProfileForm onSubmit={showSeekerForm ? addSearcherProfile : addWGProfile} type={showSeekerForm ? "seeker" : "provider"} key={showSeekerForm ? "seekerForm" : "providerForm"} />
                    </div>

                    {/* Benutzer-Dashboards (falls Profile vorhanden) */}
                    {(showMySeekerDashboard || showMyWgDashboard) ? (
                        // Umschließendes Div, um Adjacent JSX zu vermeiden, wenn beide Dashboards existieren
                        <div className="flex flex-col gap-12 w-full"> 
                            {showMySeekerDashboard && (
                                <div className="bg-white p-10 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-3xl mb-12">
                                    <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">Meine Matches: Suchender findet WG</h2>
                                    {matches.filter(match => match.searcher.createdBy === userId).length === 0 ? (
                                        <p className="text-center text-gray-600 text-lg py-4">
                                            Sie haben noch keine Suchenden-Profile erstellt oder es wurden keine Matches gefunden.
                                        </p>
                                    ) : (
                                        <div className="space-y-8">
                                            {matches
                                                .filter(match => match.searcher.createdBy === userId)
                                                .map((match, index) => (
                                                    <div key={index} className="bg-[#f0f8f0] p-8 rounded-xl shadow-lg border border-[#9adfaa] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                                        <h3 className="text-2xl font-bold text-[#333333] mb-4 flex items-center">
                                                            <Search size={22} className="mr-3 text-[#5a9c68]" /> Ihr Profil: <span className="font-extrabold ml-2">{match.searcher.name}</span>
                                                        </h3>
                                                        <h4 className="text-xl font-bold text-[#5a9c68] mb-4 flex items-center">
                                                            <Heart size={20} className="mr-2" /> Passende WG-Angebote:
                                                        </h4>
                                                        <div className="space-y-4">
                                                            {match.matchingWGs.length === 0 ? (
                                                                <p className="text-gray-600 text-base">Keine passenden WGs zu Ihrem Profil.</p>
                                                            ) : (
                                                                match.matchingWGs.map(wgMatch => (
                                                                    <div key={wgMatch.wg.id} className="bg-white p-5 rounded-lg shadow border border-[#9adfaa] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                                        <div>
                                                                            <p className="font-bold text-gray-800 text-lg">WG-Name: {wgMatch.wg.name} <span className="text-sm font-normal text-gray-600">(Score: {wgMatch.score})</span></p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Gesuchtes Alter:</span> {wgMatch.wg.minAge}-{wgMatch.wg.maxAge}, <span className="font-medium">Geschlechtspräferenz:</span> {wgMatch.wg.genderPreference}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Interessen:</span> {Array.isArray(wgMatch.wg.interests) ? wgMatch.wg.interests.join(', ') : (wgMatch.wg.interests || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Persönlichkeit der Bewohner:</span> {Array.isArray(wgMatch.wg.personalityTraits) ? wgMatch.wg.personalityTraits.join(', ') : (wgMatch.wg.personalityTraits || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG-Zusammenleben:</span> {Array.isArray(wgMatch.wg.wgCommunalLiving) ? wgMatch.wg.wgCommunalLiving.join(', ') : (wgMatch.wg.wgCommunalLiving || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG-Werte:</span> {Array.isArray(wgMatch.wg.wgValues) ? wgMatch.wg.wgValues.join(', ') : (wgMatch.wg.wgValues || 'N/A')}</p>
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
                                    <h2 className="text-4xl font-extrabold text-gray-800 mb-8 text-center">Meine Matches: WG findet Suchenden</h2>
                                    {reverseMatches.filter(wgMatch => wgMatch.wg.createdBy === userId).length === 0 ? (
                                        <p className="text-center text-gray-600 text-lg py-4">
                                            Sie haben noch keine WG-Angebote erstellt oder es wurden keine Matches gefunden.
                                        </p>
                                    ) : (
                                        <div className="space-y-8">
                                            {reverseMatches
                                                .filter(wgMatch => wgMatch.wg.createdBy === userId)
                                                .map((wgMatch, index) => (
                                                    <div key={index} className="bg-[#fff8f0] p-8 rounded-xl shadow-lg border border-[#fecd82] transform transition-all duration-300 hover:scale-[1.005] hover:shadow-xl">
                                                        <h3 className="text-2xl font-bold text-[#333333] mb-4 flex items-center">
                                                            <HomeIcon size={22} className="mr-3 text-[#cc8a2f]" /> Ihr WG-Profil: <span className="font-extrabold ml-2">{wgMatch.wg.name}</span>
                                                        </h3>
                                                        <h4 className="text-xl font-bold text-[#cc8a2f] mb-4 flex items-center">
                                                            <Users size={20} className="mr-2" /> Passende Suchende:
                                                        </h4>
                                                        <div className="space-y-4">
                                                            {wgMatch.matchingSeekers.length === 0 ? (
                                                                <p className="text-gray-600 text-base">Keine passenden Suchenden zu Ihrem WG-Profil.</p>
                                                            ) : (
                                                                wgMatch.matchingSeekers.map(seekerMatch => (
                                                                    <div key={seekerMatch.searcher.id} className="bg-white p-5 rounded-lg shadow border border-[#fecd82] flex flex-col md:flex-row justify-between items-start md:items-center transform transition-all duration-200 hover:scale-[1.005]">
                                                                        <div>
                                                                            <p className="font-bold text-gray-800 text-lg">Suchender: {seekerMatch.searcher.name} <span className="text-sm font-normal text-gray-600">(Score: {seekerMatch.score})</span></p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Alter:</span> {seekerMatch.searcher.age}, <span className="font-medium">Geschlecht:</span> {seekerMatch.searcher.gender}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Interessen:</span> {Array.isArray(seekerMatch.searcher.interests) ? seekerMatch.searcher.interests.join(', ') : (seekerMatch.searcher.interests || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Persönlichkeit:</span> {Array.isArray(seekerMatch.searcher.personalityTraits) ? seekerMatch.searcher.personalityTraits.join(', ') : (seekerMatch.searcher.personalityTraits || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">WG-Präferenzen:</span> {Array.isArray(seekerMatch.searcher.communalLivingPreferences) ? seekerMatch.searcher.communalLivingPreferences.join(', ') : (seekerMatch.searcher.communalLivingPreferences || 'N/A')}</p>
                                                                            <p className="text-sm text-gray-600"><span className="font-medium">Werte:</span> {Array.isArray(seekerMatch.searcher.values) ? seekerMatch.searcher.values.join(', ') : (seekerMatch.searcher.values || 'N/A')}</p>
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
                        // Meldung, wenn keine eigenen Profile erstellt wurden und nicht im Admin-Modus
                        <div className="w-full max-w-xl bg-white p-8 rounded-2xl shadow-xl text-center text-gray-600 mb-12 mx-auto">
                            <p className="text-lg">Bitte erstellen Sie ein Suchenden-Profil oder ein WG-Angebot, um Ihre Matches zu sehen.</p>
                            <button
                                onClick={() => setShowSeekerForm(true)}
                                className="mt-6 px-6 py-3 bg-[#3fd5c1] text-white font-bold rounded-xl shadow-lg hover:bg-[#32c0ae] transition duration-150 ease-in-out transform hover:-translate-y-0.5"
                            >
                                <span className="flex items-center"><Search size={20} className="mr-2" /> Profil erstellen</span>
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default App;