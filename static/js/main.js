// Initialize the app when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Check for necessary browser support
    if (!window.AudioContext && !window.webkitAudioContext) {
        alert('Your browser does not support the Web Audio API. Please try using a modern browser like Chrome, Firefox, or Edge.');
        return;
    }
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support accessing the microphone. Please try using a modern browser like Chrome, Firefox, or Edge.');
        return;
    }
    
    // Create and initialize the application
    const app = new SeeingSound();
    window.__seeingSound = app; // handy for debugging in the console
});
