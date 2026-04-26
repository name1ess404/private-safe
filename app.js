// Use a different name (supabaseClient) to avoid clashing with the library's global name
const SUPABASE_URL = 'https://oizwspsegossbhwrzuxw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pendzcHNlZ29zc2Jod3J6dXh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMTQ4NzgsImV4cCI6MjA5Mjc5MDg3OH0.XDcE9omc-5piEpmn3fnZjYhUcBkOnHK4cPSFrP7f_oA';

// The CDN library provides the 'supabase' object; we use it to create our client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let userKey = null;

// --- ENCRYPTION LOGIC ---

async function deriveKey(password, username) {
    const encoder = new TextEncoder();
    const salt = encoder.encode(username.trim().toLowerCase()); // Normalize username
    const baseKey = await crypto.subtle.importKey(
        "raw", 
        encoder.encode(password), 
        "PBKDF2", 
        false, 
        ["deriveKey"]
    );
    
    return await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// --- UPDATED BULLETPROOF ENCRYPTION ---

async function encryptData(text, key) {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedText = encoder.encode(text);

    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encodedText
    );

    // Convert to Base64 safely
    const ciphertext = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    const ivText = btoa(String.fromCharCode(...iv));

    return { ciphertext, iv: ivText };
}

async function decryptData(ciphertext, iv, key) {
    try {
        // Convert from Base64 back to Uint8Array
        const encryptedData = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
        const ivData = Uint8Array.from(atob(iv), c => c.charCodeAt(0));

        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: ivData },
            key,
            encryptedData
        );

        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.error("Decryption failed:", e);
        throw new Error("Decryption Error");
    }
}

// --- AUTHENTICATION ---

async function handleAuth(type) {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const email = `${user}@internal.app`; 

    const { data, error } = type === 'signup' 
        ? await supabaseClient.auth.signUp({ email, password: pass })
        : await supabaseClient.auth.signInWithPassword({ email, password: pass });

    if (error) return alert(error.message);
    
    userKey = await deriveKey(pass, user);
    showApp(user);
    loadNotes();
}

function showApp(username) {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
    document.getElementById('user-display').innerText = `Logged in as: ${username}`;
}

// --- UPDATED SAVE FUNCTION ---
async function saveNote() {
    const title = document.getElementById('note-title').value;
    const content = document.getElementById('note-content').value;
    
    if (!userKey) return alert("Key missing! Log in again.");
    if (!title || !content) return alert("Fill in both fields.");

    const { data: { user } } = await supabaseClient.auth.getUser();

    // Encrypt both using the same function
    // Note: encryptData returns { ciphertext, iv }
    const encryptedTitle = await encryptData(title, userKey);
    const encryptedContent = await encryptData(content, userKey);

    const { error } = await supabaseClient.from('notes').insert([{
        user_id: user.id,
        title: encryptedTitle.ciphertext,
        content: encryptedContent.ciphertext,
        iv: encryptedContent.iv // We store the content's IV to use for both
    }]);

    if (error) alert(error.message);
    else {
        document.getElementById('note-title').value = '';
        document.getElementById('note-content').value = '';
        setTimeout(loadNotes, 500);
    }
}

// --- UPDATED LOAD FUNCTION ---
async function loadNotes() {
    const { data, error } = await supabaseClient.from('notes').select('*').order('created_at', { ascending: false });
    if (error) return;

    const list = document.getElementById('notes-list');
    list.innerHTML = '';

    for (const note of data) {
        try {
            // CRITICAL: We must use the exact same IV stored in the DB row
            // We use note.iv for both because we saved it that way above
            const decTitle = await decryptData(note.title, note.iv, userKey);
            const decContent = await decryptData(note.content, note.iv, userKey);
            
            list.innerHTML += `
                <div class="note-card">
                    <h3>${decTitle}</h3>
                    <p>${decContent}</p>
                    <button onclick="deleteNote('${note.id}')">Delete</button>
                </div>`;
        } catch (e) {
            console.error("Decryption failed for note:", note.id, e);
            list.innerHTML += `<div class="note-card"><p style="color:red;">[Decryption Error: Data possibly corrupted or wrong key]</p></div>`;
        }
    }
}
async function deleteNote(id) {
    await supabaseClient.from('notes').delete().eq('id', id);
    loadNotes();
}

function logout() {
    supabaseClient.auth.signOut();
    location.reload();
}