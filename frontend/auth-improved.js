// IMPROVED AUTHENTICATION SCRIPT FOR EARLYGOD.AI
// Replaces the existing auth-simple.js with better session detection and user experience

// Simple state management
let authCheckInterval = null;
let currentUser = null;
let isAuthenticated = false;

// Initialize authentication system
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};
async function initializeAuth() {
    log('🔐 Initializing improved authentication system...');
    log('🔧 window.electronAPI available:', !!window.electronAPI);
    log('🔧 getSessionToken available:', !!window.electronAPI?.getSessionToken);
    
    try {
        // Hide main app initially
        const mainApp = document.getElementById('app');
        if (mainApp) {
            mainApp.style.display = 'none';
        }
        
        // Check for existing authentication
        log('🔍 Checking for existing authentication...');
        const authToken = await window.electronAPI?.getSessionToken();
        log('🔍 Auth token received:', authToken, 'Type:', typeof authToken);
        log('🔍 Checking conditions...');
        log('🔍 authToken === "authenticated":', authToken === 'authenticated');
        log('🔍 authToken === true:', authToken === true);
        log('🔍 !!authToken:', !!authToken);
        
        // Check if authenticated
        if (authToken === 'authenticated' || authToken === true || authToken) {
            log('✅ User already authenticated, showing authenticated UI');
            log('🎯 Calling handleAuthSuccess immediately...');
            
            // Create mock user data for authenticated user
            const mockVerification = {
                authenticated: true,
                user: {
                    email: 'user@earlygod.ai',
                    name: 'Gaming User',
                    imageUrl: null
                }
            };
            
            handleAuthSuccess(mockVerification);
            
            // ✅ CRITICAL: Also reload guides when user is already authenticated
            setTimeout(() => {
                if (window.loadSavedGuides) {
                    log('🔄 Reloading guides for already authenticated user...');
                    window.loadSavedGuides();
                }
            }, 500);
            
            return;
        }
        
        // No valid session found, show login screen
        log('🔐 No valid session found, showing login screen');
        log('🔐 Auth token was:', authToken);
        showLoginScreen();
        
    } catch (error) {
        console.error('❌ Error in authentication initialization:', error);
        showLoginScreen();
    }
}

// Show improved login screen
function showLoginScreen() {
    log('🔐 Showing improved login screen');
    
    // Hide main app
    const mainApp = document.getElementById('app');
    if (mainApp) {
        mainApp.style.display = 'none';
    }
    
    // Remove existing login screen
    const existingLogin = document.getElementById('improved-login');
    if (existingLogin) {
        existingLogin.remove();
    }
    
    // Create improved login screen
    const loginScreen = document.createElement('div');
    loginScreen.id = 'improved-login';
    loginScreen.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 40%, #2a2a2a 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 99999;
    `;
    
    loginScreen.innerHTML = `
        <div style="
            background: #1f1f23;
            border: 1px solid #2d2d30;
            border-radius: 16px;
            padding: 40px;
            width: 100%;
            max-width: 450px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            text-align: center;
            color: white;
        ">
            <!-- Logo -->
            <div style="margin-bottom: 24px;">
                <h1 style="
                    margin: 0 0 8px;
                    font-size: 28px;
                    font-weight: 700;
                    background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                ">EarlyGod.ai</h1>
                <p style="
                    margin: 0 0 32px;
                    color: #94a3b8;
                    font-size: 16px;
                ">Your AI Gaming Assistant</p>
            </div>
            
            <!-- Sign In Button -->
            <button id="discord-signin-btn" onclick="handleDiscordSignIn()" style="
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                width: 100%;
                padding: 16px 24px;
                background: #5865F2;
                border: 1px solid #4752C4;
                border-radius: 12px;
                font-size: 16px;
                font-weight: 500;
                color: #ffffff;
                cursor: pointer;
                transition: all 0.2s ease;
                margin-bottom: 16px;
            " onmouseover="this.style.backgroundColor='#4752C4'; this.style.transform='translateY(-1px)'" 
               onmouseout="this.style.backgroundColor='#5865F2'; this.style.transform='translateY(0)'">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
                <span id="signin-text">Continue with Discord</span>
            </button>
            
            <!-- Manual Check Button (Hidden initially) -->
            <button id="manual-check-btn" onclick="checkAuthenticationStatus()" style="
                display: none;
                width: 100%;
                padding: 12px 24px;
                background: rgba(100, 116, 139, 0.1);
                border: 1px solid rgba(100, 116, 139, 0.2);
                border-radius: 8px;
                color: #94a3b8;
                font-size: 14px;
                cursor: pointer;
                margin-bottom: 16px;
            " onmouseover="this.style.backgroundColor='rgba(100, 116, 139, 0.2)'" 
               onmouseout="this.style.backgroundColor='rgba(100, 116, 139, 0.1)'">
                🔍 Check if I'm already signed in
            </button>
            
            <!-- Help Text -->
            <p style="
                font-size: 12px;
                color: #64748b;
                line-height: 1.5;
                margin: 16px 0 0;
            ">
                Secure authentication powered by Clerk.<br>
                The app will automatically detect when you sign in.
            </p>
        </div>
    `;
    
    document.body.appendChild(loginScreen);
    
    // Start simple session checking after showing login screen
    startPeriodicCheck();
    
    log('✅ Improved login screen displayed');
}

// Simple Discord sign-in
async function handleDiscordSignIn() {
    log('🔐 Opening Discord sign-in');
    
    const authStatus = document.getElementById('auth-status');
    
    try {
        await window.electronAPI?.startSignIn();
        
        if (authStatus) {
            authStatus.innerHTML = `
                <div style="color: #22c55e; font-weight: 600; margin-bottom: 12px;">
                    ✅ Authentication Window Opened
                </div>
                <p style="color: #64748b; font-size: 14px; margin: 0;">
                    Sign in with Discord in the popup window. This app will detect when you're done.
                </p>
            `;
        }
        
        // Start intensive checking since auth window is open
        startIntensiveCheck();
        
    } catch (error) {
        console.error('❌ Sign-in error:', error);
        if (authStatus) {
            authStatus.innerHTML = `
                <div style="color: #ef4444; font-weight: 600; margin-bottom: 12px;">
                    ❌ Failed to Open Browser
                </div>
                <p style="color: #64748b; font-size: 14px; margin: 0;">Please try again.</p>
            `;
        }
    }
}

// Simple periodic session checking - DISABLED during active sessions
function startPeriodicCheck() {
    if (authCheckInterval) return;
    
    log('🔄 Starting session checking...');
    
    authCheckInterval = setInterval(async () => {
        // Skip auth check if gaming session is active - don't interrupt voice sessions
        if (window.gamingSessionActive) {
            log('⏭️ Skipping auth check - gaming session active');
            return;
        }
        
        const isAuth = await checkAuthenticationStatus();
        if (isAuth) {
            clearInterval(authCheckInterval);
            authCheckInterval = null;
        }
    }, 3000);
}

// Intensive checking when auth window is active
function startIntensiveCheck() {
    if (authCheckInterval) clearInterval(authCheckInterval);
    
    log('🔄 Starting intensive session checking...');
    
    authCheckInterval = setInterval(async () => {
        // Skip auth check if gaming session is active - don't interrupt voice sessions
        if (window.gamingSessionActive) {
            log('⏭️ Skipping auth check - gaming session active');
            return;
        }
        
        const isAuth = await checkAuthenticationStatus();
        if (isAuth) {
            clearInterval(authCheckInterval);
            authCheckInterval = null;
        }
    }, 1000); // Check every second when auth window is open
}

// Check authentication status
async function checkAuthenticationStatus() {
    try {
        // Skip if already authenticated - hold the status for the entire app session
        if (isAuthenticated) {
            log('✅ Already authenticated - holding status, no recheck needed');
            return true;
        }
        
        const authToken = await window.electronAPI?.getSessionToken();
        
        // Check if user is authenticated (handle different return values)
        if (authToken === 'authenticated' || authToken === true || authToken) {
            log('✅ Authentication detected via status check!');
            
            // Create mock user data
            const mockVerification = {
                authenticated: true,
                user: {
                    email: 'user@earlygod.ai',
                    name: 'Gaming User',
                    imageUrl: null
                }
            };
            
            handleAuthSuccess(mockVerification);
            return true;
        }
        
        return false;
        
    } catch (error) {
        log('🔍 Auth check error (normal during checking):', error.message);
        return false;
    }
}

// Handle successful authentication
function handleAuthSuccess(verificationData) {
    log('✅ Authentication successful:', verificationData.user.email);
    
    // Update state
    currentUser = verificationData.user;
    isAuthenticated = true;
    
    // Stop checking
    stopAuthChecking();
    
    // Hide login screen
    const loginScreen = document.getElementById('improved-login');
    if (loginScreen) {
        loginScreen.style.display = 'none';
    }
    
    // Show main app
    const mainApp = document.getElementById('app');
    if (mainApp) {
        mainApp.style.display = 'block';
        log('✅ Main app displayed');
    }
    
    // Update header with user info
    setTimeout(() => updateUserHeader(currentUser), 100);
    
    // Log success
    if (window.electronAPI?.logToTerminal) {
        window.electronAPI.logToTerminal(`✅ [AUTH] User authenticated: ${currentUser.email}`);
    }
}

// Update header with user information
function updateUserHeader(user) {
    const headerControls = document.querySelector('.header-controls');
    if (!headerControls) return;
    
    // Remove existing user menu
    const existingUserMenu = headerControls.querySelector('.user-menu');
    if (existingUserMenu) {
        existingUserMenu.remove();
    }
    
    // Add new user menu
    const userMenu = document.createElement('div');
    userMenu.className = 'user-menu';
    userMenu.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
        background: rgba(34, 197, 94, 0.1);
        border-radius: 12px;
        border: 1px solid rgba(34, 197, 94, 0.2);
    `;
    
    userMenu.innerHTML = `
        <img src="${user.imageUrl || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSI+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiNmYmJmMjQiLz48L3N2Zz4='}" 
             alt="${user.name}" 
             style="
                width: 32px; 
                height: 32px; 
                border-radius: 50%; 
                border: 2px solid rgba(34, 197, 94, 0.3);
                object-fit: cover;
             ">
        <span style="
            color: #22c55e; 
            font-weight: 500; 
            font-size: 14px;
        ">${user.name || user.email}</span>
        <button onclick="handleSignOut()" style="
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            color: #fca5a5;
            padding: 6px 12px;
            border-radius: 8px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
        " onmouseover="this.style.backgroundColor='rgba(239, 68, 68, 0.2)'" 
           onmouseout="this.style.backgroundColor='rgba(239, 68, 68, 0.1)'">
            Sign Out
        </button>
    `;
    
    headerControls.appendChild(userMenu);
}

// Handle sign out
async function handleSignOut() {
    if (!confirm('Are you sure you want to sign out?')) {
        return;
    }
    
    log('👋 Signing out...');
    
    try {
        await window.electronAPI?.signOut();
        
        // Reset state
        currentUser = null;
        isAuthenticated = false;
        
        // Show login screen
        showLoginScreen();
        
    } catch (error) {
        console.error('❌ Sign out error:', error);
        alert('Sign out failed: ' + error.message);
    }
}

// Listen for authentication success from auth window
if (window.electronAPI?.onAuthSuccess) {
    log('🔧 Setting up auth success listener in renderer');
    window.electronAPI.onAuthSuccess(async (data) => {
        log('✅ Auth success received in renderer:', data);
        
        if (data.authenticated) {
            // Authentication completed successfully
            log('🎉 OAuth completed successfully, showing authenticated UI');
            
            // Hide login screen and show main app
            const loginScreen = document.getElementById('improved-login');
            if (loginScreen) {
                log('✅ Hiding login screen');
                loginScreen.remove();
            }
            
            const mainApp = document.getElementById('app');
            if (mainApp) {
                log('✅ Showing main app with grid layout');
                mainApp.style.display = 'grid'; // Restore grid layout for left/right columns
            }
            
            // Update state
            currentUser = { email: 'user@earlygod.ai', name: 'Gaming User' };
            isAuthenticated = true;
            
            // Stop any auth checking
            if (authCheckInterval) {
                clearInterval(authCheckInterval);
                authCheckInterval = null;
            }
            
            // ✅ CRITICAL: Reload guides after authentication completes
            setTimeout(() => {
                if (window.loadSavedGuides) {
                    log('🔄 Reloading guides after authentication...');
                    window.loadSavedGuides();
                }
                if (window.updateLibraryView) {
                    log('🔄 Updating library view after authentication...');
                    window.updateLibraryView();
                }
            }, 500); // Small delay to ensure UI is ready
        }
    });
}

// Listen for session check requests
if (window.electronAPI?.onCheckSessionRequested) {
    window.electronAPI.onCheckSessionRequested(() => {
        log('🔍 Session check requested - checking now');
        checkAuthenticationStatus();
    });
}

// Window focus handler - REMOVED
// Don't check auth on every focus - it interrupts active gaming sessions
// Auth is checked once on app startup and held for the session
// window.addEventListener('focus', () => {
//     log('🔍 Window gained focus - checking authentication...');
//     checkAuthenticationStatus();
// });

// Make functions global for onclick handlers
window.handleDiscordSignIn = handleDiscordSignIn;
window.handleSignOut = handleSignOut;
window.checkAuthenticationStatus = checkAuthenticationStatus;
window.initializeAuth = initializeAuth;

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAuth);
} else {
    initializeAuth();
}

log('✅ Authentication script loaded');
