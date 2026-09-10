// ==UserScript==
// @name         Custom Pet-Quotes DATABASE REHAUL
// @namespace    http://tampermonkey.net/
// @version      2025-05-11
// @description  provide new-age pet quotes for the revamped neopet's pages, specific to pet lore
// @author       bat_soup
// @match        https://www.neopets.com/*
// @exclude      https://www.neopets.com/trudydaily/game.phtml
// @exclude      https://www.neopets.com/trudys_surprise.phtml
// @exclude      https://www.neopets.com/ntimes/*
// @exclude      https://www.neopets.com/~*
// @noframes
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const userData = {
        username: '',
        activePet: '',
        petList: []
    };

    // quotes to be used by program, filled after accessing database
    const quotes = [];

    // fallback quotes if no database quotes found
    const DEFAULT_QUOTES = [
        "Hello!",
        "I have something to say.",
        "I'm thinking very important thoughts.",
        "Please admire me.",
        "I have decided this is my favorite spot."
    ];

    // messages displayed for information or debugging
    const infoData = {
        error: '',
        messages: []
    };

    // FIX: these were being assigned without being declared, which throws
    // under 'use strict' the first time getActivePetRecord() ran.
    let activePetRecord = null;
    let randomQuote = '';

    // database variables
    const DB_NAME = 'PetQuotesDB';
    const DB_VERSION = 1;
    const QUOTES_STORE_NAME = 'quotes';

    //=====================================
    // SETUP — gets username and pet info
    //=====================================
    async function setUpData() {
        const USER_URL = 'https://www.neopets.com/quickref.phtml';

        // OPTIMIZATION: the quickref fetch and the DB connection don't
        // depend on each other until *after* both finish (we only need
        // userData.activePet once we're about to query the DB). Kicking
        // the DB open off at the same time as the fetch lets the network
        // round-trip and the IndexedDB handshake overlap instead of
        // happening back-to-back.
        const dbPromise = openDatabase();
        const response = await fetch(USER_URL, { credentials: 'include' });
        const isLoggedIn = !response.url.includes('login');

        if (!isLoggedIn) {
            infoData.error = 'User not logged in, not running quotes on this page.';
            return false;
        }

        const html = await response.text();
        getPetListAndActivePet(html);

        if (!userData.username || !userData.activePet) {
            infoData.error = 'Could not determine logged-in user or active pet from quickref.';
            return false;
        }

        infoData.messages.push('User logged in. Grabbed list of neopets and current active neopet.');

        // FIX: this now genuinely waits for the DB read to finish before
        // setUpData resolves, because getActivePetRecord properly wraps
        // the IndexedDB request in a Promise (see below). We hand it the
        // already-opening DB connection instead of opening a second one.
        await getActivePetRecord(dbPromise);
        return true;
    }

    //=====================================
    // DATABASE FUNCTIONS
    //=====================================
    function openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function(event) {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(QUOTES_STORE_NAME)) {
                    db.createObjectStore(QUOTES_STORE_NAME, { keyPath: 'petName' });
                }
            };

            request.onsuccess = function(event) {
                resolve(event.target.result);
            };

            request.onerror = function(event) {
                reject(event.target.error);
            };
        });
    }

    // FIX: IndexedDB's request.onsuccess is a callback, not something
    // `await` can see through on its own. We open the DB (already a
    // promise), then wrap just the request/transaction lifecycle in a
    // new Promise so the caller can genuinely await the result.
    // Accepts the in-flight dbPromise from setUpData so we don't open a
    // second connection.
    async function getActivePetRecord(dbPromise) {
        const db = await dbPromise;
        const transaction = db.transaction(QUOTES_STORE_NAME, 'readwrite');
        const quotes_store = transaction.objectStore(QUOTES_STORE_NAME);
        const request = quotes_store.get(userData.activePet);

        return new Promise((resolve, reject) => {
            request.onsuccess = function(event) {
                const activePet = event.target.result;

                if (!activePet) {
                    infoData.messages.push(`${userData.activePet} not found in the database.`);
                    const pet = { petName: userData.activePet, quotes: [] };
                    quotes_store.put(pet);
                    activePetRecord = pet;
                    infoData.messages.push(`Database record created for ${userData.activePet}.`);
                } else {
                    infoData.messages.push(`Database record found for ${userData.activePet}.`);
                    activePetRecord = activePet;
                    if (activePet.quotes && activePet.quotes.length) {
                        quotes.push(...activePet.quotes);
                        infoData.messages.push(`Quotes found for ${userData.activePet}!`);
                    } else {
                        infoData.messages.push(`No quotes found for ${userData.activePet}, using fallback quotes.`);
                    }
                }
            };

            request.onerror = function(event) {
                infoData.error = `Failed to read database record for ${userData.activePet}.`;
                reject(event.target.error);
            };

            transaction.oncomplete = function() {
                db.close();
                resolve(activePetRecord);
            };

            transaction.onerror = function(event) {
                reject(event.target.error);
            };
        });
    }

    // Writes a full replacement quotes array for one pet. Same pattern as
    // getActivePetRecord: open the DB, kick off the write, then wrap the
    // transaction lifecycle in a Promise so callers can await completion.
    async function savePetQuotes(petName, quotesArray) {
        const db = await openDatabase();
        const transaction = db.transaction(QUOTES_STORE_NAME, 'readwrite');
        const quotes_store = transaction.objectStore(QUOTES_STORE_NAME);
        quotes_store.put({ petName, quotes: quotesArray });

        return new Promise((resolve, reject) => {
            transaction.oncomplete = function() {
                db.close();
                resolve();
            };
            transaction.onerror = function(event) {
                reject(event.target.error);
            };
        });
    }

    //=====================================
    // ALLOW USER TO EDIT PET DATA
    //=====================================
    function editPet() {
        openEditQuotesModal();
    }

    //=====================================
    // GET PET LIST AND ACTIVE PET FROM QUICKREF
    //=====================================
    function getPetListAndActivePet(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // grabbing username
        const userName = doc.querySelector('.user a')?.textContent.trim();
        userData.username = userName;

        // grabbing pet list
        const petImgs = doc.querySelectorAll('.pet_toggler img');
        userData.petList = [...petImgs].map(img => img.title.trim()).filter(Boolean);

        // grabbing current active pet
        const activePetImg = doc.querySelector('.active_pet .pet_toggler img');
        userData.activePet = activePetImg?.title.trim();
    }

    //=====================================
    // START
    //=====================================
    // FIX: switched from 'load' to 'DOMContentLoaded'. 'load' waits for
    // every resource on the page, including ad iframes/images — that's
    // almost certainly why this felt slower for non-premium users.
    // DOMContentLoaded fires as soon as the HTML is parsed, which is all
    // this script actually needs.
    window.addEventListener('DOMContentLoaded', async () => {
        createInfoButton();
        const success = await setUpData();

        // quotes fallback
        if (!quotes.length) {
            quotes.push(...DEFAULT_QUOTES);
        }

        if (!success || !quotes.length || !userData.username || !userData.petList.length || !userData.activePet) {
            console.warn('Required data missing. Aborting execution.', infoData.error);
            return;
        }

        randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
        appendQuote(randomQuote);

        // Extra entry point via Tampermonkey's own menu, in addition to
        // the button in the info box.
        GM_registerMenuCommand('Edit Pet Quotes', editPet);
    });

    /////=======AESTHETICS===========

    // APPEND QUOTE ONTO DOC
    function appendQuote(randomQuote) {
        // check for existing quote, the case for old pages
        const existingQuote = document.querySelector('.neopetPhrase');
        const oldPage = document.querySelector('#neobdy'); // found on old pages
        const validPage = document.body.querySelector('div'); // for edge cases like coconut shy process, training school course completion.

        if (existingQuote) {
            existingQuote.innerHTML =
                `<b>${userData.activePet} says: </b>
                 <br> ${randomQuote}`;
            return;
        }

        // FIX: comment now matches the actual condition (90%, not 30%)
        const showQuote = oldPage ? false : !validPage ? false : Math.random() < 0.9; // 90% chance to show
        if (!showQuote) return;

        // style pet's name
        const petNameSpan = document.createElement('span');
        petNameSpan.textContent = `${userData.activePet} says: `;
        petNameSpan.style.fontWeight = 'bold';
        petNameSpan.style.color = '#333';

        // style quote
        const petQuoteSpan = document.createElement('span');
        petQuoteSpan.textContent = `"${randomQuote}"`;
        petQuoteSpan.style.color = '#5A5A5A';

        // create quotebox
        const quoteBox = document.createElement('div');
        quoteBox.appendChild(petNameSpan);
        quoteBox.appendChild(petQuoteSpan);

        // Style the box
        Object.assign(quoteBox.style, {
            position: 'fixed',
            top: '65px', // adjust this if needed to match header spacing
            left: '40px', // adjust to align near pet icon
            width: '140px',
            border: '1px solid #999',
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '18px',
            fontFamily: 'Cafeteria, "Arial Bold", sans-serif',
            zIndex: '9999',
            boxShadow: '0 0 6px rgba(0,0,0,0.2)',
            pointerEvents: 'none' // prevents blocking clicks
        });
        quoteBox.style.setProperty('background-color', '#f2f7f9', 'important');

        document.body.appendChild(quoteBox);
    }

    // EDIT QUOTES MODAL — lets the user view every quote on record for the
    // active pet, add new ones, edit or delete existing ones, all against
    // a local draft. Nothing touches IndexedDB until "Save" is clicked;
    // "Cancel" (or clicking outside the panel) discards the draft.
    function openEditQuotesModal() {
        if (!userData.activePet) {
            alert('No active pet loaded yet — try reloading the page.');
            return;
        }

        document.querySelector('#petQuotesEditModal')?.remove();

        // Work on a copy so in-progress edits never touch the real data.
        const draftQuotes = (activePetRecord?.quotes || []).slice();

        const overlay = document.createElement('div');
        overlay.id = 'petQuotesEditModal';
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0', left: '0', right: '0', bottom: '0',
            backgroundColor: 'rgba(0,0,0,0.45)',
            zIndex: '200000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Arial, sans-serif'
        });
        // click outside the panel to cancel
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) overlay.remove();
        });

        const panel = document.createElement('div');
        Object.assign(panel.style, {
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            padding: '20px',
            width: '340px',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            fontSize: '14px',
            color: '#333'
        });

        const heading = document.createElement('h3');
        heading.textContent = `Edit quotes — ${userData.activePet}`;
        heading.style.margin = '0 0 12px 0';
        panel.appendChild(heading);

        const list = document.createElement('div');
        Object.assign(list.style, {
            overflowY: 'auto',
            flex: '1',
            marginBottom: '10px',
            border: '1px solid #ddd',
            borderRadius: '6px',
            padding: '8px'
        });
        panel.appendChild(list);

        function renderList() {
            list.innerHTML = '';
            if (!draftQuotes.length) {
                const empty = document.createElement('div');
                empty.textContent = 'No quotes yet — add one below.';
                empty.style.color = '#888';
                empty.style.fontSize = '13px';
                list.appendChild(empty);
                return;
            }
            draftQuotes.forEach((quoteText, index) => {
                const row = document.createElement('div');
                Object.assign(row.style, { display: 'flex', gap: '6px', marginBottom: '6px' });

                const input = document.createElement('input');
                input.type = 'text';
                input.value = quoteText;
                Object.assign(input.style, {
                    flex: '1',
                    padding: '4px 6px',
                    fontSize: '13px',
                    border: '1px solid #ccc',
                    borderRadius: '4px'
                });
                // edits write straight into the draft array as the user types
                input.addEventListener('input', () => {
                    draftQuotes[index] = input.value;
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = '✕';
                deleteBtn.title = 'Delete quote';
                Object.assign(deleteBtn.style, {
                    border: 'none',
                    backgroundColor: '#e0e0e0',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    padding: '4px 8px'
                });
                deleteBtn.addEventListener('click', () => {
                    draftQuotes.splice(index, 1);
                    renderList();
                });

                row.appendChild(input);
                row.appendChild(deleteBtn);
                list.appendChild(row);
            });
        }
        renderList();

        // add-new-quote row
        const addRow = document.createElement('div');
        Object.assign(addRow.style, { display: 'flex', gap: '6px', marginBottom: '14px' });

        const addInput = document.createElement('input');
        addInput.type = 'text';
        addInput.placeholder = 'New quote...';
        Object.assign(addInput.style, {
            flex: '1',
            padding: '4px 6px',
            fontSize: '13px',
            border: '1px solid #ccc',
            borderRadius: '4px'
        });

        const addBtn = document.createElement('button');
        addBtn.textContent = '+ Add';
        Object.assign(addBtn.style, {
            border: 'none',
            backgroundColor: '#cfe8d8',
            borderRadius: '4px',
            cursor: 'pointer',
            padding: '4px 10px'
        });

        function addQuoteFromInput() {
            const text = addInput.value.trim();
            if (!text) return;
            draftQuotes.push(text);
            addInput.value = '';
            renderList();
        }
        addBtn.addEventListener('click', addQuoteFromInput);
        addInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') addQuoteFromInput();
        });

        addRow.appendChild(addInput);
        addRow.appendChild(addBtn);
        panel.appendChild(addRow);

        // footer: cancel / save
        const footer = document.createElement('div');
        Object.assign(footer.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px' });

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        Object.assign(cancelBtn.style, {
            padding: '6px 14px',
            border: '1px solid #999',
            borderRadius: '4px',
            backgroundColor: '#f2f2f2',
            cursor: 'pointer'
        });
        cancelBtn.addEventListener('click', () => overlay.remove());

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        Object.assign(saveBtn.style, {
            padding: '6px 14px',
            border: 'none',
            borderRadius: '4px',
            backgroundColor: '#5a9bd5',
            color: '#fff',
            cursor: 'pointer'
        });
        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            try {
                const cleaned = draftQuotes.map(q => q.trim()).filter(Boolean);
                await savePetQuotes(userData.activePet, cleaned);

                // keep this page's in-memory state consistent with the DB
                quotes.length = 0;
                quotes.push(...(cleaned.length ? cleaned : DEFAULT_QUOTES));
                if (activePetRecord) activePetRecord.quotes = cleaned;

                overlay.remove();
            } catch (err) {
                console.error('Failed to save quotes:', err);
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save';
                alert('Something went wrong saving your quotes — check the console for details.');
            }
        });

        footer.appendChild(cancelBtn);
        footer.appendChild(saveBtn);
        panel.appendChild(footer);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    }

    // INFORMATION BUTTON ON BOTTOM OF PAGE
    function createInfoButton() {
        const button = document.createElement('button');
        button.textContent = '🗨';

        Object.assign(button.style, {
            position: 'fixed',
            bottom: '15px',
            right: '15px',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '1px solid #999',
            backgroundColor: '#f2f7f9',
            cursor: 'pointer',
            fontSize: '20px',
            zIndex: '100000',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)'
        });

        button.addEventListener('click', showInfo);
        document.body.appendChild(button);
    }

    function showInfo() {
        const existingInfo = document.querySelector('#petQuotesInfo');

        // If the information box is already open, close it.
        if (existingInfo) {
            existingInfo.remove();
            return;
        }

        const infoBox = document.createElement('div');
        infoBox.id = 'petQuotesInfo';

        infoBox.innerHTML = `
        <strong>🐾 Pet Quotes</strong>
        <br><br>
        Logged in: ${userData.username || 'No'}
        <br>
        Active pet: ${userData.activePet || 'Unknown'}
        <br>
        Quotes loaded: ${quotes.length}
        <br>
        Quote Picked: ${randomQuote || 'Unknown'}
        <br>
        All Messages: ${infoData.messages.join('; ')}
        <br>
        Error: ${infoData.error || 'None!'}
    `;

        Object.assign(infoBox.style, {
            position: 'fixed',
            bottom: '65px',
            right: '15px',
            width: '250px',
            padding: '15px',
            backgroundColor: '#ffffff',
            border: '1px solid #999',
            borderRadius: '8px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.25)',
            zIndex: '100000',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            color: '#333'
        });

        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️ Edit Quotes';
        Object.assign(editBtn.style, {
            marginTop: '10px',
            width: '100%',
            padding: '6px 0',
            border: '1px solid #999',
            borderRadius: '4px',
            backgroundColor: '#f2f7f9',
            cursor: 'pointer',
            fontSize: '13px'
        });
        editBtn.addEventListener('click', openEditQuotesModal);
        infoBox.appendChild(editBtn);

        document.body.appendChild(infoBox);
    }

})();
