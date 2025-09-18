# APX Lens - AI Assistant Chrome Extension

APX Lens is a Chrome extension that provides an AI-powered sidebar assistant similar to Claude for Chrome. It can analyze webpage content, interact with page elements, and provide intelligent assistance while browsing.

## Features

- 🤖 **AI Chat Sidebar**: Beautiful, responsive chat interface that slides in from the right
- 📄 **Page Analysis**: Automatically analyze and extract content from any webpage  
- 📸 **Screenshot Capture**: Take and analyze screenshots of the current page
- 🔍 **Content Interaction**: View and interact with page elements as requested
- 🎨 **Modern UI**: Clean, professional design with smooth animations
- 🌙 **Dark Mode**: Automatic dark mode support based on system preferences
- ⌨️ **Keyboard Shortcuts**: Quick access via customizable keyboard shortcuts

## Installation

### From Source (Developer Mode)

1. **Clone or Download the Repository**
   ```bash
   git clone https://github.com/romirthedev/apx-lens.git
   cd apx-lens
   ```

2. **Enable Developer Mode in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Toggle on "Developer mode" in the top right corner

3. **Load the Extension**
   - Click "Load unpacked" button
   - Select the `apx-lens` folder containing the extension files
   - The extension should now appear in your extensions list

4. **Pin the Extension**
   - Click the extensions icon in the Chrome toolbar (puzzle piece)
   - Pin "APX Lens" for easy access

## Usage

### Opening the AI Chat

**Method 1: Extension Icon**
- Click the APX Lens icon in your Chrome toolbar
- Click "Open AI Chat" in the popup

**Method 2: Keyboard Shortcut**
- Press `Ctrl+Shift+A` (Windows/Linux) or `Cmd+Shift+A` (Mac)

**Method 3: Right-click Context Menu**
- Right-click on any webpage
- Select "Open APX Lens" from the context menu

### Analyzing Page Content

**Quick Analysis:**
- Click the APX Lens icon
- Click "Analyze Page" for instant content analysis

**Custom Analysis:**
- Open the chat sidebar
- Type commands like:
  - "Analyze this page"
  - "What is this page about?"
  - "Summarize the main content"
  - "Extract all the links"

### Interactive Features

The AI assistant can help you with:

- **Content Analysis**: Understand page structure, extract key information
- **Navigation Help**: Find specific elements or information on the page
- **Data Extraction**: Pull out specific data points, links, or text
- **Page Interaction**: Guidance on how to use forms, buttons, or features
- **Research Assistance**: Answer questions about the content you're viewing

### Example Commands

```
"What is the main topic of this article?"
"Extract all the email addresses from this page"
"Summarize the key points in bullet format"
"Help me understand this technical documentation"
"Find the contact information on this site"
"What are the main navigation options?"
```

## Extension Structure

```
apx-lens/
├── manifest.json          # Extension configuration
├── popup.html             # Extension popup interface
├── popup.css              # Popup styling
├── popup.js               # Popup functionality
├── content-script.js      # Main content script for page interaction
├── content-styles.css     # Sidebar and UI styles
├── background.js          # Background service worker
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md              # This file
```

## Permissions

The extension requires the following permissions:

- **Active Tab**: To interact with the current webpage
- **Tabs**: To capture screenshots and get tab information
- **Storage**: To save user preferences and settings
- **Scripting**: To inject the chat sidebar into webpages
- **Host Permissions**: To work on all websites

## Development

### Building the Extension

No build process is required. The extension runs directly from the source files.

### Customization

**Styling**: Modify `content-styles.css` and `popup.css` to customize the appearance
**Functionality**: Update `content-script.js` to add new features
**AI Integration**: Replace the mock AI responses in `content-script.js` with actual AI API calls

### AI Integration

Currently, the extension includes simulated AI responses. To integrate with a real AI service:

1. Add your AI API configuration to `background.js`
2. Implement actual API calls in the `processUserMessage` function in `content-script.js`
3. Add necessary API keys to the extension's settings

## Browser Compatibility

- ✅ Chrome (Manifest V3)
- ✅ Edge (Chromium-based)
- ❌ Firefox (requires Manifest V2 conversion)
- ❌ Safari (requires different extension format)

## Privacy & Security

- No data is collected or transmitted without user consent
- All processing happens locally in the browser
- Screenshots and page content are not stored permanently
- When AI integration is added, users should be informed about data usage

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT License - see LICENSE file for details

## Support

For questions, issues, or feature requests, please:
1. Check the existing issues on GitHub
2. Create a new issue with detailed information
3. Provide steps to reproduce any bugs

---

**Note**: This extension is currently in development. AI responses are simulated and will require integration with an actual AI service for full functionality.