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
        //open database at same time
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
        //waiting on database 
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
                infoData.messages.push("Database successfully opened.")
                resolve(event.target.result);
            };

            request.onerror = function(event) {
                infoData.error = "Error opening the database."
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

    //=====================================
    // ALLOW USER TO EDIT PET DATA
    //=====================================
    function editPet() {
      //TODO
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
        <strong>🗨 Pet Quotes</strong>
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

        document.body.appendChild(infoBox);
    }

})();
