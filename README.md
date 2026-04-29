# Seeing Sound

A high-performance, real-time spectrogram visualization web application that transforms sound into a visually captivating experience.

## Overview

Seeing Sound provides a window into the world of sound by visualizing audio captured through your device's microphone as a smooth, high-resolution spectrogram. The application is designed to be deeply engaging and visually appealing, making it accessible and enjoyable for everyone, especially those who cannot hear.

## Features

- **Real-Time Visualization**: Experience sound as a continuously scrolling spectrogram with time flowing from right to left and frequency displayed vertically.
- **Exceptional Smoothness**: Enjoy an exquisitely fluid visual experience with optimized rendering for minimal lag.
- **High Resolution**: See intricate details in the audio spectrum with high visual fidelity.
- **Beautiful Color Mapping**: Visualize audio with a carefully designed color gradient that maps low frequencies to deep reds and higher frequencies to vibrant yellows, with brightness representing intensity.
- **Customizable Parameters**:
  - **Detail Level**: Adjust the FFT size to balance between frequency resolution and temporal responsiveness.
  - **Frequency Range**: Focus on specific frequency bands of interest.
  - **Noise Threshold**: Filter out background noise for a cleaner visualization.
  - **Scroll Speed**: Control how quickly the spectrogram moves across the screen.
- **Responsive Design**: Enjoy a seamless experience across different devices and screen sizes.

## Usage

- **Start/Stop**: Click the "Start Listening" button to begin capturing and visualizing audio. Click "Stop Listening" to pause.
- **Detail Level**: Select from Low (512), Medium (1024), High (2048), Very High (4096), or Ultra (8192) FFT size settings.
- **Frequency Range**: Adjust the minimum and maximum frequencies to focus on particular ranges, or use the preset buttons:
  - **Default**: 0-4000 Hz (standard audible range)
  - **Music**: 20-20000 Hz (full human hearing range)
  - **Ultrasounds**: 20000-40000 Hz (beyond human hearing range)
- **Noise Threshold**: Set a threshold below which audio signals are not displayed to reduce visual clutter.
- **Scroll Speed**: Choose between Slow, Medium, Fast, and Very Fast to control the rate at which the spectrogram scrolls.

## Requirements

- A modern web browser with support for the Web Audio API (Chrome, Firefox, Safari, Edge)
- Microphone access

## Privacy

Seeing Sound processes all audio locally in your browser. No audio data is transmitted to any server or stored permanently.

## License

This project is open source, available under the MIT License.

---

Seeing Sound - Experience sound in a new dimension