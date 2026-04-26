const SUPABASE_URL = 'https://oizwspsegossbhwrzuxw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pendzcHNlZ29zc2Jod3J6dXh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMTQ4NzgsImV4cCI6MjA5Mjc5MDg3OH0.XDcE9omc-5piEpmn3fnZjYhUcBkOnHK4cPSFrP7f_oA';
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

// --- BULLETPROOF ENCRYPTION (NO CORRUPTION) ---

async function encryptData(text, key) {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encoder.encode(text)
    );

    // Convert binary to Hex string (much safer than Base64)
    const ciphertext = Array.from(new Uint8Array(encrypted))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    const ivText = Array.from(iv)
        .map(b => b.toString(16).padStart(2, '0')).join('');

    return { ciphertext, iv: ivText };
}

async function decryptData(ciphertext, iv, key) {
    try {
        // Convert Hex string back to Uint8Array
        const encryptedData = new Uint8Array(ciphertext.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const ivData = new Uint8Array(iv.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: ivData },
            key,
            encryptedData
        );

        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.error("Internal Decrypt Error:", e);
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

// --- SIMPLIFIED SAVE (Let's get this working first!) ---
async function saveNote() {
    const titleInput = document.getElementById('note-title');
    const contentInput = document.getElementById('note-content');
    
    if (!userKey) return alert("Encryption key missing. Please logout and login again.");
    if (!titleInput.value || !contentInput.value) return alert("Please fill in everything.");

    const { data: { user } } = await supabaseClient.auth.getUser();

    // Only encrypt the CONTENT for now to eliminate complexity
    const encryptedData = await encryptData(contentInput.value, userKey);

    const { error } = await supabaseClient.from('notes').insert([{
        user_id: user.id,
        title: titleInput.value, // Plain text title for testing
        content: encryptedData.ciphertext,
        iv: encryptedData.iv
    }]);

    if (error) {
        alert(error.message);
    } else {
        titleInput.value = '';
        contentInput.value = '';
        // Wait 1 second to ensure Supabase has indexed the new row
        setTimeout(loadNotes, 1000);
    }
}

// --- SIMPLIFIED LOAD ---
async function loadNotes() {
    const { data, error } = await supabaseClient.from('notes').select('*').order('created_at', { ascending: false });
    if (error) return console.error("Fetch error:", error);

    const list = document.getElementById('notes-list');
    list.innerHTML = '';

    for (const note of data) {
        try {
            // Decrypt ONLY the content
            const decContent = await decryptData(note.content, note.iv, userKey);
            
            list.innerHTML += `
                <div class="note-card">
                    <h3>${note.title}</h3> <p>${decContent}</p>
                    <button onclick="deleteNote('${note.id}')">Delete</button>
                </div>`;
        } catch (e) {
            console.error("Failed to decrypt note:", note.id, e);
            list.innerHTML += `
                <div class="note-card" style="border-color: red;">
                    <h3>${note.title}</h3>
                    <p style="color: red;">[Decryption Error: Wrong password or corrupted data]</p>
                    <button onclick="deleteNote('${note.id}')">Delete</button>
                </div>`;
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