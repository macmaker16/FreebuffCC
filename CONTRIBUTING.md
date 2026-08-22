# Contributing to Michaelangelo

Thank you for your interest in contributing to Michaelangelo! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm 9 or later
- Windows 10/11 (for building the `.exe`)

### Development Setup

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/Michaelangelo.git
   cd Michaelangelo
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start development mode:
   ```bash
   npm run dev
   ```

## Project Structure

```
Michaelangelo/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── main.ts             # App entry, window, IPC
│   │   ├── preload.ts          # Secure context bridge
│   │   └── server.ts           # Express proxy server
│   └── renderer/               # React frontend
│       └── src/
│           ├── components/     # UI components
│           ├── services/       # API utilities
│           └── types/          # TypeScript types
├── .github/workflows/          # CI/CD
└── package.json
```

## Development Workflow

### Code Style

- Use TypeScript for all new code
- Follow existing code patterns and naming conventions
- Keep functions small and focused
- Add comments for complex logic

### Testing Changes

1. Run the development server:
   ```bash
   npm run dev
   ```

2. Test the following flows:
   - Settings: Save/load API keys
   - Model Manager: Fetch, test, and select models
   - Chat: Send and receive messages

3. Verify TypeScript compilation:
   ```bash
   npm run build
   ```

### Commit Messages

Use clear, descriptive commit messages:
- `feat: Add new feature`
- `fix: Fix bug in component`
- `docs: Update documentation`
- `refactor: Improve code structure`

## Pull Request Process

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and commit them

3. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

4. Open a Pull Request on GitHub

5. Describe your changes in the PR description

6. Wait for CI checks to pass

## Reporting Issues

When reporting bugs, please include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if applicable)
- Your OS and Node.js version

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
