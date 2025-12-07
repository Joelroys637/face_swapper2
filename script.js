// TODO: PASTE YOUR FIREBASE CONFIGURATION HERE
const firebaseConfig = {
    apiKey: "AIzaSyAf0zX4YewpsT3wicoJFm9apLG2qN6BnhY",
    authDomain: "chat-application-bd8d2.firebaseapp.com",
    projectId: "chat-application-bd8d2",
    storageBucket: "chat-application-bd8d2.firebasestorage.app",
    messagingSenderId: "186686750854",
    appId: "1:186686750854:web:571ef677ab1d19d81e1107"
};

// Initialize Firebase
try {
    firebase.initializeApp(firebaseConfig);
    console.log("Firebase initialized");
} catch (e) {
    console.error("Firebase initialization failed. Make sure to update the config object.", e);
    alert("Firebase config missing! Please edit script.js with your keys.");
}

const auth = firebase.auth();
const db = firebase.firestore();
// We will use Firestore for "tables" (collections) as requested.
// Each group will be a collection OR a document with a subcollection.
// For simplicity and "table name" analogy: we'll treat the group name as a Collection ID or a Document ID in a 'groups' collection. 
// A better approach for "dynamic table name": 
// We will store messages in a collection named `messages_{groupName}` or similar to mimic "table per group" or just use a root collection `groups/{groupName}/messages`.
const storage = firebase.storage();

// State
let currentUser = null;
let currentGroup = null;
let currentGroupAction = null; // 'create' or 'join'
let messagesUnsubscribe = null;

// DOM Elements
const views = {
    auth: document.getElementById('auth-view'),
    group: document.getElementById('group-selection-view'),
    chat: document.getElementById('chat-view')
};

const forms = {
    login: document.getElementById('login-form'),
    signup: document.getElementById('signup-form')
};

const modal = {
    self: document.getElementById('group-input-modal'),
    title: document.getElementById('modal-title'),
    input: document.getElementById('group-name-input')
};

// --- AUTH HANDLERS ---

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        console.log("User logged in:", user.email);
        updateUserProfileUI();
        if (!currentGroup) {
            showView('group');
        } else {
            showView('chat');
        }
    } else {
        currentUser = null;
        console.log("User logged out");
        showView('auth');
    }
});

function switchAuthTab(type) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.tab-btn[onclick="switchAuthTab('${type}')"]`).classList.add('active');

    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
    forms[type].classList.add('active');
}

forms.signup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = e.target['signup-email'].value;
    const password = e.target['signup-password'].value;
    const username = e.target['signup-username'].value;

    try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        // Update profile with username
        await cred.user.updateProfile({
            displayName: username
        });
        console.log("Signed up");
    } catch (error) {
        alert(error.message);
    }
});

forms.login.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = e.target['login-email'].value;
    const password = e.target['login-password'].value;

    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        alert(error.message);
    }
});

function logout() {
    auth.signOut();
    currentGroup = null;
    if (messagesUnsubscribe) messagesUnsubscribe();
}

// --- VIEW NAVIGATION ---

function showView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
}

function updateUserProfileUI() {
    if (currentUser) {
        document.getElementById('current-user-avatar').textContent = (currentUser.displayName || currentUser.email)[0].toUpperCase();
    }
}

// --- GROUP MANAGEMENT ---

function showGroupInput(action) {
    currentGroupAction = action;
    modal.self.classList.remove('hidden');
    modal.title.textContent = action === 'create' ? 'Create New Group' : 'Join Existing Group';
    modal.input.value = '';
    modal.input.focus();
}

function closeGroupModal() {
    modal.self.classList.add('hidden');
}

async function handleGroupAction() {
    const groupName = modal.input.value.trim();
    if (!groupName) return;

    // Sanitize group name to be safe for collection names if needed, 
    // but Firestore handles most strings. Let's force lowercase for consistency.
    const groupId = groupName.toLowerCase().replace(/\s+/g, '_');

    if (currentGroupAction === 'create') {
        // In a real app we might check if it exists first, but here we just "open" it.
        // We can create a metadata doc if we want, or just start writing messages.
        // Let's check existence for better UX if it was strict 'create', 
        // but for this MVP, creating just means defining the collection.
        await enterGroup(groupName, groupId);
    } else {
        // Join
        await enterGroup(groupName, groupId);
    }

    closeGroupModal();
}

async function enterGroup(name, id) {
    currentGroup = { name, id };

    // Update Chat Header
    document.getElementById('header-group-name').textContent = name;
    document.getElementById('header-group-avatar').textContent = name[0].toUpperCase();
    document.getElementById('sidebar-group-name').textContent = name;

    showView('chat');
    loadMessages(id);
}

function leaveGroup() {
    currentGroup = null;
    if (messagesUnsubscribe) messagesUnsubscribe();
    showView('group');
}

// --- CHAT LOGIC ---

function loadMessages(groupId) {
    const messagesList = document.getElementById('messages-list');
    messagesList.innerHTML = ''; // Clear old

    // Listen to the "messages" subcollection of the group
    const messagesRef = db.collection('groups').doc(groupId).collection('messages');

    messagesUnsubscribe = messagesRef
        .orderBy('timestamp', 'asc')
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    renderMessage(change.doc.data());
                }
            });
            // Scroll to bottom immediately
            messagesList.scrollTop = messagesList.scrollHeight;
        }, (error) => {
            console.error("Firestore Error:", error);
            // If the query requires an index, Firestore will throw an error with a link in the console.
            if (error.message.includes('index')) {
                alert("This query requires a Firestore Index. Open the browser console (F12) and click the link provided by Firebase.");
            } else {
                alert("Error loading chats: " + error.message);
            }
        });
}

function renderMessage(data) {
    const messagesList = document.getElementById('messages-list');
    const isMe = data.senderId === currentUser.uid;

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isMe ? 'sent' : 'received'}`;

    let contentHtml = '';
    if (data.imageUrl) {
        // Add onload to scroll when image is fully loaded
        contentHtml += `<img src="${data.imageUrl}" alt="Shared Image" onload="this.parentElement.scrollIntoView({ behavior: 'smooth' })">`;
    }
    if (data.text) {
        contentHtml += `<p>${data.text}</p>`;
    }

    // Format timestamp
    const date = data.timestamp ? data.timestamp.toDate() : new Date();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgDiv.innerHTML = `
        <span class="sender-name">${isMe ? 'You' : data.senderName}</span>
        ${contentHtml}
        <span class="time">${timeStr}</span>
    `;

    messagesList.appendChild(msgDiv);
    messagesList.scrollTop = messagesList.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    const fileInput = document.getElementById('image-upload');
    const file = fileInput.files[0];

    if ((!text && !file) || !currentGroup) return;

    // Clear inputs immediately for UX
    input.value = '';
    fileInput.value = '';

    let imageUrl = null;

    try {
        if (file) {
            // Upload to Firebase Storage: group_images/{groupId}/{timestamp}_{filename}
            const storageRef = storage.ref(`group_images/${currentGroup.id}/${Date.now()}_${file.name}`);
            const snapshot = await storageRef.put(file);
            imageUrl = await snapshot.ref.getDownloadURL();
        }

        // Add to Firestore
        await db.collection('groups').doc(currentGroup.id).collection('messages').add({
            text: text,
            imageUrl: imageUrl,
            senderId: currentUser.uid,
            senderName: currentUser.displayName || currentUser.email,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

    } catch (error) {
        console.error("Error sending message:", error);
        alert("Failed to send message: " + error.message);
    }
}
