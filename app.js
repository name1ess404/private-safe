const SUPABASE_URL = 'https://oizwspsegossbhwrzuxw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pendzcHNlZ29zc2Jod3J6dXh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMTQ4NzgsImV4cCI6MjA5Mjc5MDg3OH0.XDcE9omc-5piEpmn3fnZjYhUcBkOnHK4cPSFrP7f_oA';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let userKey = null;

// --- 1. CRYPTO UTILITIES ---

async function deriveKey(password, username) {
    const encoder = new TextEncoder();
    const salt = encoder.encode(username.trim().toLowerCase());
    const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    
    return await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptData(text, key) {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(text));

    const ciphertext = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    return { ciphertext, iv: ivHex };
}

async function decryptData(ciphertext, ivHex, key) {
    try {
        const encryptedData = new Uint8Array(ciphertext.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encryptedData);
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        throw new Error("Decryption failed");
    }
}

// --- 2. PERSISTENCE LOGIC ---

async function saveSession(user, pass, duration) {
    if (duration === 'session') return;
    const expiry = duration === 'forever' ? null : Date.now() + (parseInt(duration) * 60 * 60 * 1000);
    localStorage.setItem('crypto_session', JSON.stringify({ user, pass, expiry }));
}

async function checkAutoLogin() {
    const saved = localStorage.getItem('crypto_session');
    if (!saved) return;
    const session = JSON.parse(saved);
    if (session.expiry && Date.now() > session.expiry) {
        localStorage.removeItem('crypto_session');
        return;
    }
    document.getElementById('username').value = session.user;
    document.getElementById('password').value = session.pass;
    handleAuth('login');
}

// --- 3. CORE FUNCTIONS ---

async function handleAuth(type) {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const rememberMe = document.getElementById('remember-me').checked;
    const duration = document.getElementById('duration').value;

    if (!user || !pass) return alert("Enter credentials");

    const { data, error } = type === 'signup' 
        ? await supabaseClient.auth.signUp({ email: `${user}@internal.app`, password: pass })
        : await supabaseClient.auth.signInWithPassword({ email: `${user}@internal.app`, password: pass });

    if (error) return alert(error.message);

    if (rememberMe) await saveSession(user, pass, duration);
    userKey = await deriveKey(pass, user);
    showApp(user);
    loadNotes();
}

function showApp(username) {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
    document.getElementById('user-display').innerText = `User: ${username}`;
}

async function saveNote() {
    const tInput = document.getElementById('note-title');
    const cInput = document.getElementById('note-content');
    if (!userKey || !tInput.value || !cInput.value) return alert("Fill all fields");

    const { data: { user } } = await supabaseClient.auth.getUser();
    const tEnc = await encryptData(tInput.value, userKey);
    const cEnc = await encryptData(cInput.value, userKey);

    const { error } = await supabaseClient.from('notes').insert([{
        user_id: user.id,
        title: tEnc.ciphertext + ":" + tEnc.iv,
        content: cEnc.ciphertext,
        iv: cEnc.iv
    }]);

    if (error) alert(error.message);
    else { tInput.value = ''; cInput.value = ''; setTimeout(loadNotes, 500); }
}

async function loadNotes() {
    const { data, error } = await supabaseClient.from('notes').select('*').order('created_at', { ascending: false });
    if (error) return;
    const list = document.getElementById('notes-list');
    list.innerHTML = '';

    for (const note of data) {
        try {
            const [tCipher, tIv] = note.title.split(':');
            const decTitle = await decryptData(tCipher, tIv, userKey);
            const decContent = await decryptData(note.content, note.iv, userKey);
            list.innerHTML += `<div class="note-card"><h3>${decTitle}</h3><p>${decContent}</p><button onclick="deleteNote('${note.id}')">Delete</button></div>`;
        } catch (e) {
            list.innerHTML += `<div class="note-card" style="opacity:0.5"><h3>[Encrypted/Old Note]</h3><button onclick="deleteNote('${note.id}')">Delete</button></div>`;
        }
    }
}

async function deleteNote(id) {
    await supabaseClient.from('notes').delete().eq('id', id);
    loadNotes();
}

function logout() {
    localStorage.removeItem('crypto_session');
    supabaseClient.auth.signOut();
    location.reload();
}

window.onload = checkAutoLogin;