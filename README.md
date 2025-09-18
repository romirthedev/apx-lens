# Gemini Lens 🔍

A sleek Chrome extension that brings Google Gemini AI directly to your browser, allowing you to analyze, summarize, and chat about any webpage content.

## ✨ Features

- **Smart Page Analysis**: Get AI-powered insights about any webpage
- **Content Summarization**: Quickly summarize long articles and documents
- **Interactive Chat**: Have conversations with Gemini about the current page
- **Side Panel Interface**: Clean, modern chat interface that doesn't interfere with browsing
- **Quick Actions**: One-click analysis and summarization from the popup
- **Beautiful UI**: Sleek white and sky blue design that's easy on the eyes

## 🚀 Installation

### Prerequisites

1. **Google Chrome Browser** (version 88 or higher)
2. **Gemini API Key** from [Google AI Studio](https://makersuite.google.com/app/apikey)

### Setup Instructions

1. **Download the Extension**
   ```bash
   git clone <repository-url>
   cd apx-lens
   ```

2. **Load the Extension in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in the top right)
   - Click "Load unpacked" and select the `apx-lens` folder
   - The Gemini Lens extension should now appear in your extensions list

3. **Configure Your API Key**
   - Click the Gemini Lens icon in your Chrome toolbar
   - Enter your Gemini API key in the settings section
   - Toggle "Auto-analyze pages" if you want automatic analysis (optional)
   - Click "Save Settings"

## 🔧 Getting Your Gemini API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the generated API key
5. Paste it into the Gemini Lens extension settings

**Note**: Keep your API key secure and never share it publicly.

## 📖 Usage

### Quick Actions (Popup)

1. **Open Side Panel**: Click to open the chat interface
2. **Analyze Page**: Get instant AI analysis of the current webpage
3. **Summarize**: Generate a concise summary of the page content

### Chat Interface (Side Panel)

1. **Open the Side Panel**:
   - Click the Gemini Lens icon and select "Open Side Panel"
   - Or use the keyboard shortcut (if configured)

2. **Start Chatting**:
   - Type your questions about the current page
   - Ask for explanations, summaries, or analysis
   - Request specific information extraction

3. **Example Prompts**:
   - "What are the main points of this article?"
   - "Explain this concept in simple terms"
   - "Find the contact information on this page"
   - "What are the pros and cons mentioned?"

### Advanced Features

- **Context Awareness**: The AI understands the current page content
- **Conversation History**: Chat history is maintained per tab
- **Smart Content Extraction**: Automatically filters out ads and navigation
- **Multi-language Support**: Works with pages in different languages

## 🎨 UI Overview

### Popup Interface
- **Clean Design**: Minimalist white and sky blue theme
- **Quick Actions**: Three main action buttons for common tasks
- **Settings Panel**: Easy API key configuration
- **Status Indicators**: Visual feedback for all operations

### Side Panel
- **Chat Interface**: WhatsApp-style messaging layout
- **Page Context**: Shows current page title and URL
- **Message History**: Persistent conversation per tab
- **Loading States**: Smooth animations during AI processing

## 🔒 Privacy & Security

- **Local Processing**: Page content is processed locally before sending to Gemini
- **Secure API Calls**: All communications use HTTPS
- **No Data Storage**: Conversations are stored locally and can be cleared anytime
- **Permission-Based**: Only accesses pages when explicitly activated

## 🛠️ Technical Details

### File Structure
```
apx-lens/
├── manifest.json          # Extension configuration
├── popup.html            # Popup interface
├── popup.css             # Popup styling
├── popup.js              # Popup functionality
├── sidepanel.html        # Side panel interface
├── sidepanel.css         # Side panel styling
├── sidepanel.js          # Side panel functionality
├── background.js         # Background service worker
├── content.js            # Content script for page interaction
└── README.md             # This file
```

### Permissions Used
- `activeTab`: Access current tab content
- `sidePanel`: Enable side panel functionality
- `storage`: Save user preferences and API key
- `scripting`: Inject content scripts for page analysis

## 🐛 Troubleshooting

### Common Issues

**Extension not working:**
- Ensure Developer mode is enabled in Chrome
- Check that the API key is correctly entered
- Verify internet connection for API calls

**API errors:**
- Confirm your Gemini API key is valid
- Check if you have remaining API quota
- Ensure the API key has proper permissions

**Side panel not opening:**
- Try refreshing the current page
- Disable and re-enable the extension
- Check Chrome version compatibility

### Error Messages

- **"Invalid API key"**: Check your Gemini API key configuration
- **"Failed to analyze page"**: The page content might be restricted or the API is unavailable
- **"Network error"**: Check your internet connection

## 🔄 Updates

To update the extension:
1. Download the latest version
2. Replace the old files
3. Go to `chrome://extensions/`
4. Click the refresh icon on the Gemini Lens extension

## 📝 Changelog

### Version 1.0.0
- Initial release
- Basic chat functionality with Gemini
- Page analysis and summarization
- Side panel interface
- Popup quick actions

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and enhancement requests.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Google Gemini AI for the powerful language model
- Chrome Extensions API for the platform
- The open-source community for inspiration and resources

---

**Enjoy browsing with AI assistance! 🚀**