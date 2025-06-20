import React, { useState } from 'react';

// Hauptkomponente der WG-Matching-App
const App = () => {
    // Zustände für die Profile von Suchenden und Anbietenden
    const [seekerProfiles, setSeekerProfiles] = useState([]);
    const [providerProfiles, setProviderProfiles] = useState([]);
    // Zustand für die aktuell angezeigte Ansicht
    const [currentView, setCurrentView] = useState('home'); // 'home', 'createSeeker', 'createProvider', 'viewMatches'
    // Zustand für das aktuell ausgewählte WG-Profil zum Matchen
    const [selectedProviderId, setSelectedProviderId] = useState('');
    // Zustand für temporäre Formularfelder
    const [form, setForm] = useState({}); // <--- HIER WURDE DER FEHLER BEHOBEN

    // Persönlichkeitsmerkmale und Interessen zur Auswahl
    const traits = ['ordentlich', 'ruhig', 'gesellig', 'kreativ', 'sportlich', 'nachtaktiv', 'frühaufsteher'];
    const interests = ['Kochen', 'Filme', 'Musik', 'Spiele', 'Natur', 'Sport', 'Lesen', 'Reisen'];

    // Funktion zum Zurücksetzen des Formulars
    const resetForm = () => {
        setForm({});
    };

    // Funktion zur Handhabung von Änderungen in den Formularfeldern
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        if (type === 'checkbox') {
            const currentValues = form[name] || [];
            if (checked) {
                setForm({ ...form, [name]: [...currentValues, value] });
            } else {
                setForm({ ...form, [name]: currentValues.filter((item) => item !== value) });
            }
        } else {
            setForm({ ...form, [name]: value });
        }
    };

    // Funktion zum Speichern eines Suchenden-Profils
    const handleSaveSeekerProfile = (e) => {
        e.preventDefault();
        const newSeeker = { id: crypto.randomUUID(), ...form };
        setSeekerProfiles([...seekerProfiles, newSeeker]);
        resetForm();
        setCurrentView('home');
        console.log('Suchenden-Profil gespeichert:', newSeeker);
    };

    // Funktion zum Speichern eines Anbietenden-Profils (WG)
    const handleSaveProviderProfile = (e) => {
        e.preventDefault();
        const newProvider = { id: crypto.randomUUID(), ...form };
        setProviderProfiles([...providerProfiles, newProvider]);
        resetForm();
        setCurrentView('home');
        console.log('Anbietenden-Profil gespeichert:', newProvider);
    };

    // Funktion zur Berechnung des Match-Scores zwischen einem Suchenden und einem Anbietenden
    const calculateMatchScore = (seeker, provider) => {
        let score = 0;

        // Match auf Persönlichkeitsmerkmale
        if (seeker.personalityTraits && provider.currentResidentsPersonality) {
            seeker.personalityTraits.forEach(trait => {
                if (provider.currentResidentsPersonality.includes(trait)) {
                    score += 5; // Hoher Wert für Übereinstimmung
                }
            });
        }

        // Match auf Interessen
        if (seeker.interests && provider.currentResidentsInterests) {
            seeker.interests.forEach(interest => {
                if (provider.currentResidentsInterests.includes(interest)) {
                    score += 3; // Mittlerer Wert für Übereinstimmung
                }
            });
        }

        // Match auf 'lookingFor' (Suchender) und 'description'/'lookingForInFlatmate' (Anbietender)
        const seekerLookingFor = (seeker.lookingFor || '').toLowerCase();
        const providerDescription = (provider.description || '').toLowerCase();
        const providerLookingFor = (provider.lookingForInFlatmate || '').toLowerCase();

        // Keywords from seeker's lookingFor
        const seekerKeywords = seekerLookingFor.split(' ').filter(word => word.length > 2);
        seekerKeywords.forEach(keyword => {
            if (providerDescription.includes(keyword) || providerLookingFor.includes(keyword)) {
                score += 2;
            }
        });

        // Keywords from provider's lookingForInFlatmate
        const providerKeywords = providerLookingFor.split(' ').filter(word => word.length > 2);
        providerKeywords.forEach(keyword => {
            if (seekerLookingFor.includes(keyword)) {
                score += 2;
            }
        });

        // Mietpreis-Match
        if (seeker.maxRent && provider.rent && seeker.maxRent >= provider.rent) {
            score += 10; // Hoher Wert, wenn die Miete passt
        } else if (seeker.maxRent && provider.rent && seeker.maxRent < provider.rent) {
            score -= 10; // Negativer Wert, wenn Miete zu hoch
        }

        // Haustiere erlaubt
        if (seeker.pets && provider.petsAllowed && seeker.pets === 'ja' && provider.petsAllowed === 'ja') {
            score += 5;
        } else if (seeker.pets && provider.petsAllowed && seeker.pets === 'ja' && provider.petsAllowed === 'nein') {
            score -= 5;
        }

        // Alter Match (einfache Nähe)
        if (seeker.age && provider.avgAge) {
            score -= Math.abs(seeker.age - provider.avgAge); // Je näher, desto besser
        }

        return score;
    };

    // Funktion zur Anzeige der Match-Ergebnisse
    const handleViewMatches = () => {
        if (!selectedProviderId) return;

        const selectedProvider = providerProfiles.find(p => p.id === selectedProviderId);
        if (!selectedProvider) return;

        // Berechne Matches für alle Suchenden
        const matches = seekerProfiles.map(seeker => ({
            seeker,
            score: calculateMatchScore(seeker, selectedProvider),
        }));

        // Sortiere die Matches nach Score absteigend
        matches.sort((a, b) => b.score - a.score);

        return (
            <div className="p-6 bg-white rounded-xl shadow-lg w-full max-w-2xl mx-auto">
                <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Matches für {selectedProvider.wgName}</h2>
                {matches.length === 0 ? (
                    <p className="text-gray-600 text-center">Keine passenden Suchenden gefunden.</p>
                ) : (
                    matches.map(match => (
                        <div key={match.seeker.id} className="mb-4 p-4 border border-gray-200 rounded-lg bg-gray-50 hover:bg-gray-100 transition duration-300">
                            <h3 className="text-xl font-semibold text-gray-900">{match.seeker.name} (Score: {match.score})</h3>
                            <p className="text-gray-700">Alter: {match.seeker.age}</p>
                            <p className="text-gray-700">Beruf: {match.seeker.occupation || 'N/A'}</p>
                            <p className="text-gray-700">Persönlichkeit: {match.seeker.personalityTraits?.join(', ') || 'N/A'}</p>
                            <p className="text-gray-700">Interessen: {match.seeker.interests?.join(', ') || 'N/A'}</p>
                            <p className="text-gray-700">Sucht: {match.seeker.lookingFor || 'N/A'}</p>
                            <p className="text-gray-700">Max. Miete: {match.seeker.maxRent ? `${match.seeker.maxRent} €` : 'N/A'}</p>
                            <button
                                onClick={() => alert(`Einladung an ${match.seeker.name} gesendet! (MVP-Funktion)`)}
                                className="mt-3 px-6 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold rounded-lg shadow-md hover:from-purple-700 hover:to-indigo-700 transition duration-300"
                            >
                                Einladen
                            </button>
                        </div>
                    ))
                )}
                <div className="flex justify-center mt-6">
                    <button
                        onClick={() => setCurrentView('home')}
                        className="px-6 py-3 bg-gray-300 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-400 transition duration-300"
                    >
                        Zurück zur Startseite
                    </button>
                </div>
            </div>
        );
    };


    // Formular-Komponente für Suchende und Anbietende
    const renderProfileForm = (type) => (
        <div className="p-6 bg-white rounded-xl shadow-lg w-full max-w-md mx-auto">
            <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">
                {type === 'seeker' ? 'Suchenden-Profil erstellen' : 'WG-Profil erstellen'}
            </h2>
            <form onSubmit={type === 'seeker' ? handleSaveSeekerProfile : handleSaveProviderProfile}>
                {/* Allgemeine Felder */}
                <div className="mb-4">
                    <label htmlFor="name" className="block text-gray-700 text-sm font-semibold mb-2">
                        {type === 'seeker' ? 'Name' : 'WG-Name'}
                    </label>
                    <input
                        type="text"
                        id="name"
                        name={type === 'seeker' ? 'name' : 'wgName'}
                        value={form[type === 'seeker' ? 'name' : 'wgName'] || ''}
                        onChange={handleChange}
                        required
                        className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                {type === 'seeker' && (
                    <div className="mb-4">
                        <label htmlFor="age" className="block text-gray-700 text-sm font-semibold mb-2">Alter</label>
                        <input
                            type="number"
                            id="age"
                            name="age"
                            value={form.age || ''}
                            onChange={handleChange}
                            required
                            className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>
                )}

                <div className="mb-4">
                    <label htmlFor="location" className="block text-gray-700 text-sm font-semibold mb-2">Ort / Stadtteil</label>
                    <input
                        type="text"
                        id="location"
                        name="location"
                        value={form.location || ''}
                        onChange={handleChange}
                        className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                {/* Persönlichkeitsmerkmale */}
                <div className="mb-4">
                    <label className="block text-gray-700 text-sm font-semibold mb-2">
                        {type === 'seeker' ? 'Deine Persönlichkeitsmerkmale' : 'Persönlichkeitsmerkmale der aktuellen Bewohner'}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        {traits.map(trait => (
                            <label key={trait} className="inline-flex items-center text-gray-800">
                                <input
                                    type="checkbox"
                                    name={type === 'seeker' ? 'personalityTraits' : 'currentResidentsPersonality'}
                                    value={trait}
                                    checked={(form[type === 'seeker' ? 'personalityTraits' : 'currentResidentsPersonality'] || []).includes(trait)}
                                    onChange={handleChange}
                                    className="form-checkbox h-5 w-5 text-blue-600 rounded"
                                />
                                <span className="ml-2">{trait}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Interessen (nur für Suchende relevant für MVP) */}
                {type === 'seeker' && (
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-semibold mb-2">Deine Interessen</label>
                        <div className="grid grid-cols-2 gap-2">
                            {interests.map(interest => (
                                <label key={interest} className="inline-flex items-center text-gray-800">
                                    <input
                                        type="checkbox"
                                        name="interests"
                                        value={interest}
                                        checked={(form.interests || []).includes(interest)}
                                        onChange={handleChange}
                                        className="form-checkbox h-5 w-5 text-blue-600 rounded"
                                    />
                                    <span className="ml-2">{interest}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                {/* Spezifische Felder für Suchende */}
                {type === 'seeker' && (
                    <>
                        <div className="mb-4">
                            <label htmlFor="maxRent" className="block text-gray-700 text-sm font-semibold mb-2">Maximale Miete (€)</label>
                            <input
                                type="number"
                                id="maxRent"
                                name="maxRent"
                                value={form.maxRent || ''}
                                onChange={handleChange}
                                className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="pets" className="block text-gray-700 text-sm font-semibold mb-2">Haustiere (Ja/Nein)</label>
                            <select
                                id="pets"
                                name="pets"
                                value={form.pets || ''}
                                onChange={handleChange}
                                className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                                <option value="">Bitte wählen</option>
                                <option value="ja">Ja</option>
                                <option value="nein">Nein</option>
                            </select>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="lookingFor" className="block text-gray-700 text-sm font-semibold mb-2">Was suchst du in einer WG?</label>
                            <textarea
                                id="lookingFor"
                                name="lookingFor"
                                value={form.lookingFor || ''}
                                onChange={handleChange}
                                rows="3"
                                className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            ></textarea>
                        </div>
                    </>
                )}

                {/* Spezifische Felder für Anbietende (WG) */}
                {type === 'provider' && (
                    <>
                        <div className="mb-4">
                            <label htmlFor="description" className="block text-gray-700 text-sm font-semibold mb-2">Beschreibung der WG</label>
                            <textarea
                                id="description"
                                name="description"
                                value={form.description || ''}
                                onChange={handleChange}
                                rows="3"
                                className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            ></textarea>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="rent" className="block text-gray-700 text-sm font-semibold mb-2">Miete (€)</label>
                            <input
                                type="number"
                                id="rent"
                                name="rent"
                                value={form.rent || ''}
                                onChange={handleChange}
                                className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="roomType" className="block text-gray-700 text-sm font-semibold mb-2">Zimmertyp</label>
                            <select
                                id="roomType"
                                name="roomType"
                                value={form.roomType || ''}
                                onChange={handleChange}
                                className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                                <option value="">Bitte wählen</option>
                                <option value="Einzelzimmer">Einzelzimmer</option>
                                <option value="Doppelzimmer">Doppelzimmer</option>
                            </select>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="petsAllowed" className="block text-gray-700 text-sm font-semibold mb-2">Haustiere erlaubt (Ja/Nein)</label>
                            <select
                                id="petsAllowed"
                                name="petsAllowed"
                                value={form.petsAllowed || ''}
                                onChange={handleChange}
                                className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                                <option value="">Bitte wählen</option>
                                <option value="ja">Ja</option>
                                <option value="nein">Nein</option>
                            </select>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="avgAge" className="block text-gray-700 text-sm font-semibold mb-2">Durchschnittsalter der Bewohner</label>
                            <input
                                type="number"
                                id="avgAge"
                                name="avgAge"
                                value={form.avgAge || ''}
                                onChange={handleChange}
                                className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="lookingForInFlatmate" className="block text-gray-700 text-sm font-semibold mb-2">Was sucht ihr im neuen Mitbewohner?</label>
                            <textarea
                                id="lookingForInFlatmate"
                                name="lookingForInFlatmate"
                                value={form.lookingForInFlatmate || ''}
                                onChange={handleChange}
                                rows="3"
                                className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            ></textarea>
                        </div>
                    </>
                )}

                <div className="flex justify-between mt-6">
                    <button
                        type="button"
                        onClick={() => { resetForm(); setCurrentView('home'); }}
                        className="px-6 py-3 bg-gray-300 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-400 transition duration-300"
                    >
                        Abbrechen
                    </button>
                    <button
                        type="submit"
                        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-teal-600 text-white font-semibold rounded-lg shadow-md hover:from-blue-700 hover:to-teal-700 transition duration-300"
                    >
                        Profil speichern
                    </button>
                </div>
            </form>
        </div>
    );

    // Haupt-Render-Logik basierend auf der aktuellen Ansicht
    return (
        <div className="min-h-screen bg-gray-100 flex flex-col items-center py-10 px-4 font-inter">
            <style>
                {`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
                body {
                    font-family: 'Inter', sans-serif;
                }
                `}
            </style>
            <h1 className="text-5xl font-extrabold text-gray-900 mb-10 text-center">WG-Match</h1>

            {currentView === 'home' && (
                <div className="flex flex-col md:flex-row gap-6">
                    <button
                        onClick={() => setCurrentView('createSeeker')}
                        className="flex-1 px-8 py-5 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-xl rounded-xl shadow-lg hover:from-green-600 hover:to-emerald-700 transition duration-300 transform hover:scale-105"
                    >
                        Suchenden-Profil erstellen
                    </button>
                    <button
                        onClick={() => setCurrentView('createProvider')}
                        className="flex-1 px-8 py-5 bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold text-xl rounded-xl shadow-lg hover:from-orange-600 hover:to-red-700 transition duration-300 transform hover:scale-105"
                    >
                        WG-Profil erstellen
                    </button>
                    <button
                        onClick={() => {
                            if (providerProfiles.length > 0) {
                                setCurrentView('viewMatches');
                                setSelectedProviderId(providerProfiles[0].id); // Wähle das erste WG-Profil als Standard
                            } else {
                                alert('Bitte erstellen Sie zuerst ein WG-Profil, um Matches anzuzeigen.');
                            }
                        }}
                        className="flex-1 px-8 py-5 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold text-xl rounded-xl shadow-lg hover:from-blue-600 hover:to-purple-700 transition duration-300 transform hover:scale-105"
                    >
                        Matches anzeigen
                    </button>
                </div>
            )}

            {currentView === 'createSeeker' && renderProfileForm('seeker')}
            {currentView === 'createProvider' && renderProfileForm('provider')}

            {currentView === 'viewMatches' && (
                <div className="w-full max-w-3xl">
                    <div className="p-6 bg-white rounded-xl shadow-lg mb-6">
                        <label htmlFor="selectProvider" className="block text-gray-700 text-sm font-semibold mb-2">
                            Wähle ein WG-Profil:
                        </label>
                        <select
                            id="selectProvider"
                            value={selectedProviderId}
                            onChange={(e) => setSelectedProviderId(e.target.value)}
                            className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            {providerProfiles.length === 0 && <option value="">Keine WG-Profile verfügbar</option>}
                            {providerProfiles.map(provider => (
                                <option key={provider.id} value={provider.id}>{provider.wgName}</option>
                            ))}
                        </select>
                    </div>
                    {selectedProviderId && handleViewMatches()}
                    {!selectedProviderId && providerProfiles.length > 0 && (
                        <p className="text-gray-600 text-center">Bitte wählen Sie ein WG-Profil, um Matches zu sehen.</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default App;