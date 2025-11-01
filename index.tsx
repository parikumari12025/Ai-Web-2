
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// Codemirror Imports (handled by importmap)
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { MergeView } from '@codemirror/merge';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { sql } from '@codemirror/lang-sql';

// --- BUNDLED: types.ts ---
const LANGUAGES = [
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'C++',
  'Go',
  'Rust',
  'HTML',
  'CSS',
  'SQL',
  'Shell',
] as const;

type Language = typeof LANGUAGES[number];

type AiMode =
  | 'ASSIST'
  | 'GENERATE'
  | 'DEBUG'
  | 'REFACTOR'
  | 'REVIEW'
  | 'GENERATE_DOCS'
  | 'GENERATE_TESTS'
  | 'ANALYZE_REPO';

// --- BUNDLED: services/geminiService.ts ---
if (!process.env.API_KEY) {
  // This is a placeholder check; in a browser environment, process.env isn't directly available this way.
  // The key is expected to be provided in the execution environment where the app is hosted.
  console.warn("API_KEY environment variable not set. Please ensure it is configured in your deployment environment.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const generateContent = async (prompt: string): Promise<string> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: prompt,
        });
        return response.text;
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        if (error instanceof Error) {
            return `Error: ${error.message}`;
        }
        return "An unknown error occurred.";
    }
};

const analyzeCode = (code: string, problem: string, language: Language): Promise<string> => {
    const prompt = `
    You are an expert programmer and code assistant. Analyze the following ${language} code and resolve the described issue.
    Provide a detailed explanation of the problem, suggest a corrected version of the code, and explain the fix.
    Format your response in Markdown.

    **Issue Description:**
    ${problem}

    **Code:**
    \`\`\`${language.toLowerCase()}
    ${code}
    \`\`\`
    `;
    return generateContent(prompt);
};

const generateCode = (description: string, language: Language): Promise<string> => {
    const prompt = `
    You are an expert programmer and code generation assistant.
    Generate a snippet of ${language} code based on the following description.
    Include a brief explanation of how the code works.
    Format your response in Markdown, with the code in a proper code block.

    **Description:**
    ${description}
    `;
    return generateContent(prompt);
};

const debugAndExecuteCode = (code: string, language: Language): Promise<string> => {
    if (language === 'JavaScript') {
        try {
            let output = '';
            const oldLog = console.log;
            console.log = (...args) => {
                output += args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ') + '\n';
            };
            new Function(code)();
            console.log = oldLog;
            return Promise.resolve(`**Execution Output:**\n\`\`\`\n${output || '(No output to console)'}\n\`\`\``);
        } catch (e: any) {
            const errorPrompt = `
            You are an expert programmer and debugger. The following JavaScript code failed to execute.
            Analyze the code and the error message, explain the error, and provide a corrected version.
            Format your response in Markdown.

            **Error Message:**
            ${e.message}

            **Code:**
            \`\`\`javascript
            ${code}
            \`\`\`
            `;
            return generateContent(errorPrompt);
        }
    }

    const prompt = `
    You are an expert programmer and code execution simulator.
    Analyze the following ${language} code. First, identify any potential bugs or errors.
    If there are errors, explain them and provide a corrected version.
    If the code is valid, predict and display its output as if it were executed.
    Format your response in Markdown.

    **Code:**
    \`\`\`${language.toLowerCase()}
    ${code}
    \`\`\`
    `;
    return generateContent(prompt);
};

const refactorCode = (code: string, language: Language): Promise<string> => {
    const prompt = `
    You are an expert programmer specializing in code refactoring.
    Analyze the following ${language} code and refactor it to improve readability, performance, and adherence to best practices.
    Provide the refactored code in a proper code block.
    After the code, provide a bulleted list explaining the key changes you made and why they are beneficial.
    Format your entire response in Markdown.

    **Original Code:**
    \`\`\`${language.toLowerCase()}
    ${code}
    \`\`\`
    `;
    return generateContent(prompt);
};

const reviewCode = (code: string, language: Language): Promise<string> => {
    const prompt = `
    You are an expert programmer and code reviewer.
    Analyze the following ${language} code and provide a comprehensive review.
    DO NOT rewrite or refactor the code. Instead, provide feedback as a bulleted list under the following categories:
    - **Readability & Style:** Comments on formatting, naming conventions, and clarity.
    - **Performance & Efficiency:** Suggestions for optimizing loops, data structures, or algorithms.
    - **Potential Bugs & Vulnerabilities:** Identify any logical errors, edge cases not handled, or security risks.
    - **Best Practices:** Note any deviations from common ${language} idioms and best practices.

    Format your entire response in Markdown.

    **Code for Review:**
    \`\`\`${language.toLowerCase()}
    ${code}
    \`\`\`
    `;
    return generateContent(prompt);
};

const generateDocs = (code: string, language: Language): Promise<string> => {
    const prompt = `
    You are an expert programmer specializing in writing clear and concise technical documentation.
    Analyze the following ${language} code and generate comprehensive documentation for it.
    The documentation should include:
    - A high-level summary of what the code does.
    - For each function or class, describe its purpose, parameters (with types), and return value.
    - Include code examples for how to use the functions or classes if applicable.

    Format your entire response in Markdown. Do not include the original code in your response.

    **Code to Document:**
    \`\`\`${language.toLowerCase()}
    ${code}
    \`\`\`
    `;
    return generateContent(prompt);
};

const generateTests = (code: string, language: Language): Promise<string> => {
    const prompt = `
    You are an expert programmer specializing in software testing.
    Analyze the following ${language} code and generate a suite of unit tests for it.
    Use a common testing framework for the language (e.g., Jest for JavaScript/TypeScript, PyTest for Python, JUnit for Java, etc.).
    The tests should cover a variety of cases, including happy paths, edge cases, and error handling.
    Provide the complete test code in a proper code block, ready to be run.
    Include a brief explanation of the test cases you've created.

    Format your entire response in Markdown.

    **Code to Test:**
    \`\`\`${language.toLowerCase()}
    ${code}
    \`\`\`
    `;
    return generateContent(prompt);
};

const analyzeRepo = (readmeContent: string): Promise<string> => {
    const prompt = `
    You are an expert software engineer and project analyst.
    Analyze the following README.md file content from a GitHub repository.
    Provide a concise, high-level summary of the project.
    Your summary should include:
    - **Project Purpose:** What problem does this project solve?
    - **Key Features:** What are the main functionalities?
    - **Tech Stack:** What technologies, languages, or frameworks are mentioned?

    Format your response in Markdown with clear headings for each section.

    **README Content:**
    ---
    ${readmeContent}
    ---
    `;
    return generateContent(prompt);
};

// --- BUNDLED: components/IconComponents.tsx ---
const CodeIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
  </svg>
);
const WandIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" />
  </svg>
);
const BugIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const SparklesIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-6.857 2.143L12 21l-2.143-6.857L3 12l6.857-2.143L12 3z" />
    </svg>
);
const ChecklistIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
);
const DocumentTextIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
);
const BeakerIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h8a2 2 0 002-2v-4a2 2 0 00-2-2h-8a2 2 0 00-2 2v4a2 2 0 002 2z" />
    </svg>
);
const GitHubIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0z"/>
    </svg>
);
const PlayIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
    </svg>
);
const CopyIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);
const CheckIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);
const SunIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
);
const MoonIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
);

// --- BUNDLED: components/LoadingSpinner.tsx ---
const LoadingSpinner: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div>
        <p className="text-dark-text-secondary">AI is thinking...</p>
    </div>
  );
};

// --- BUNDLED: components/Auth.tsx ---
const Auth: React.FC<{ onLogin: () => void; onSignup: () => void; }> = ({ onLogin, onSignup }) => {
  const [isLoginView, setIsLoginView] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const validateEmail = (email: string) => {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    
    if (password.length < 6) {
        setError("Password must be at least 6 characters long.");
        return;
    }

    if (isLoginView) {
      onLogin();
    } else {
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      onSignup();
    }
  };
  
  const toggleView = () => {
      setIsLoginView(!isLoginView);
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setError(null);
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-dark-bg">
      <div className="w-full max-w-md p-8 space-y-8 bg-white dark:bg-dark-surface rounded-lg shadow-2xl">
        <div className="flex flex-col items-center">
            <div className="p-3 bg-brand-secondary rounded-full mb-4">
                <CodeIcon className="w-8 h-8 text-white"/>
            </div>
          <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-dark-text-primary">
            {isLoginView ? 'Sign in to your account' : 'Create a new account'}
          </h2>
          <p className="mt-2 text-center text-md text-gray-600 dark:text-dark-text-secondary">
            to continue to <span className="font-bold text-brand-primary">Code Assistant Pro</span>
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email-address" className="sr-only">Email address</label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-3 border border-gray-300 dark:border-dark-border bg-gray-50 dark:bg-dark-bg placeholder-gray-500 dark:placeholder-dark-text-secondary text-gray-900 dark:text-dark-text-primary rounded-t-md focus:outline-none focus:ring-brand-primary focus:border-brand-primary focus:z-10 sm:text-sm"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isLoginView ? "current-password" : "new-password"}
                required
                className={`appearance-none rounded-none relative block w-full px-3 py-3 border border-gray-300 dark:border-dark-border bg-gray-50 dark:bg-dark-bg placeholder-gray-500 dark:placeholder-dark-text-secondary text-gray-900 dark:text-dark-text-primary ${isLoginView ? 'rounded-b-md' : ''} focus:outline-none focus:ring-brand-primary focus:border-brand-primary focus:z-10 sm:text-sm`}
                placeholder="Password (min. 6 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {!isLoginView && (
              <div>
                <label htmlFor="confirm-password" className="sr-only">Confirm Password</label>
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="appearance-none rounded-none relative block w-full px-3 py-3 border border-gray-300 dark:border-dark-border bg-gray-50 dark:bg-dark-bg placeholder-gray-500 dark:placeholder-dark-text-secondary text-gray-900 dark:text-dark-text-primary rounded-b-md focus:outline-none focus:ring-brand-primary focus:border-brand-primary focus:z-10 sm:text-sm"
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            )}
          </div>
          
          {error && (
            <div className="p-3 my-2 text-sm text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/60 rounded-md text-center" role="alert">
                {error}
            </div>
          )}

          <div>
            <button
              type="submit"
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-brand-primary hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-dark-bg focus:ring-brand-primary transition-colors duration-200"
            >
              {isLoginView ? 'Sign in' : 'Sign up'}
            </button>
          </div>
        </form>
        <div className="text-sm text-center">
          <button onClick={toggleView} className="font-medium text-brand-primary hover:text-sky-400">
            {isLoginView ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- BUNDLED: components/Header.tsx ---
type Theme = 'light' | 'dark';

const Header: React.FC<{ onLogout: () => void; theme: Theme; toggleTheme: () => void; }> = ({ onLogout, theme, toggleTheme }) => {
    return (
        <header className="bg-white dark:bg-dark-surface shadow-md sticky top-0 z-50 border-b border-gray-200 dark:border-dark-border">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <div className="flex items-center space-x-3">
                        <CodeIcon className="h-8 w-8 text-brand-primary" />
                        <h1 className="text-xl font-bold text-gray-900 dark:text-dark-text-primary">AI Code Assistant Pro</h1>
                    </div>
                    <div className="flex items-center space-x-4">
                        <button
                            onClick={toggleTheme}
                            className="p-2 text-gray-500 dark:text-dark-text-secondary rounded-full hover:bg-gray-200 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-dark-surface focus:ring-brand-primary transition-colors duration-200"
                            aria-label="Toggle theme"
                        >
                            {theme === 'light' ? <MoonIcon className="w-6 h-6" /> : <SunIcon className="w-6 h-6" />}
                        </button>
                        <button
                            onClick={onLogout}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-text-primary bg-gray-200 dark:bg-dark-border rounded-md hover:bg-gray-300 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-dark-surface focus:ring-brand-primary transition-colors duration-200"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
};


// --- BUNDLED: components/CodeAssistant.tsx ---

const CodeEditor: React.FC<{
  value: string;
  onChange?: (value: string) => void;
  language: Language;
  theme: Theme;
  readOnly?: boolean;
}> = ({ value, onChange, language, theme, readOnly = false }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const getLanguageSupport = useCallback((lang: Language) => {
    switch (lang) {
      case 'JavaScript': return javascript({ jsx: true });
      case 'TypeScript': return javascript({ typescript: true });
      case 'Python': return python();
      case 'Java': return java();
      case 'C++': return cpp();
      case 'HTML': return html();
      case 'CSS': return css();
      case 'SQL': return sql();
      case 'Go':
      case 'Rust':
      case 'Shell':
      default:
        return javascript();
    }
  }, []);

  const getThemeExtension = useCallback((theme: Theme) => {
      return theme === 'dark' ? oneDark : EditorView.theme({});
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;

    const extensions = [
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      getThemeExtension(theme),
      EditorView.lineWrapping,
      getLanguageSupport(language),
      EditorState.readOnly.of(readOnly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChange) {
          onChange(update.state.doc.toString());
        }
      }),
    ];

    const startState = EditorState.create({
      doc: value,
      extensions: extensions.filter(Boolean),
    });

    const view = new EditorView({
      state: startState,
      parent: editorRef.current,
    });
    viewRef.current = view;

    return () => view.destroy();
  }, []); // Should only run on mount

  useEffect(() => {
    const view = viewRef.current;
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      const extensions = [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        getThemeExtension(theme),
        EditorView.lineWrapping,
        getLanguageSupport(language),
        EditorState.readOnly.of(readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChange) {
            onChange(update.state.doc.toString());
          }
        }),
      ];
      view.dispatch({
        effects: StateEffect.reconfigure.of(extensions.filter(Boolean)),
      });
    }
  }, [language, readOnly, theme, getLanguageSupport, getThemeExtension, onChange]);

  return <div ref={editorRef} className="w-full h-full border border-gray-300 dark:border-dark-border rounded-lg overflow-hidden [&>div]:h-full [&>div]:bg-white dark:[&>div]:bg-dark-bg" />;
};

const CodeBlock: React.FC<{ language: string; code: string; theme: Theme }> = ({ language, code, theme }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [code]);

    const normalizedLanguage = useMemo(() => {
        const lowerLang = language.toLowerCase();
        const found = LANGUAGES.find(l => l.toLowerCase() === lowerLang);
        return found || 'JavaScript';
    }, [language]);

    return (
        <div className="relative my-4 text-sm">
            <div className="bg-gray-200 dark:bg-slate-900/70 rounded-t-lg px-4 py-2 flex justify-between items-center text-xs font-sans text-gray-500 dark:text-gray-400">
                <span>{language || 'code'}</span>
                <button onClick={handleCopy} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1.5">
                    {copied ? (
                        <><CheckIcon className="w-4 h-4 text-green-500" /><span>Copied!</span></>
                    ) : (
                        <><CopyIcon className="w-4 h-4" /><span>Copy</span></>
                    )}
                </button>
            </div>
            <div className="text-left h-64">
              <CodeEditor
                  value={code}
                  language={normalizedLanguage}
                  readOnly={true}
                  theme={theme}
              />
            </div>
        </div>
    );
};

const CodeComparison: React.FC<{ originalCode: string; newCode: string; language: Language; theme: Theme; }> = ({ originalCode, newCode, language, theme }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);

  const getLanguageSupport = useCallback((lang: Language) => {
    switch (lang) {
      case 'JavaScript': return javascript({ jsx: true });
      case 'TypeScript': return javascript({ typescript: true });
      case 'Python': return python();
      case 'Java': return java();
      case 'C++': return cpp();
      case 'HTML': return html();
      case 'CSS': return css();
      case 'SQL': return sql();
      default:
        return javascript();
    }
  }, []);

  const getThemeExtension = useCallback((theme: Theme) => {
    return theme === 'dark' ? oneDark : EditorView.theme({});
  }, []);
  
  useEffect(() => {
    if (!editorRef.current) return;

    const commonExtensions = [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        getThemeExtension(theme),
        EditorState.readOnly.of(true),
        getLanguageSupport(language),
        EditorView.lineWrapping,
    ];

    const mv = new MergeView({
      a: {
        doc: originalCode,
        extensions: commonExtensions.filter(Boolean),
      },
      b: {
        doc: newCode,
        extensions: commonExtensions.filter(Boolean),
      },
      parent: editorRef.current,
    });
    mergeViewRef.current = mv;

    return () => mv.destroy();
  }, []); // Reruns only on mount

  // Handle updates
  useEffect(() => {
    const mv = mergeViewRef.current;
    if (!mv) return;

     const commonExtensions = [
        lineNumbers(),
        history(),
        // FIX: Corrected typo from defaultKeykeymap to defaultKeymap.
        keymap.of([...defaultKeymap, ...historyKeymap]),
        getThemeExtension(theme),
        EditorState.readOnly.of(true),
        getLanguageSupport(language),
        EditorView.lineWrapping,
    ];

    mv.a.setState(EditorState.create({ doc: originalCode, extensions: commonExtensions.filter(Boolean) }));
    mv.b.setState(EditorState.create({ doc: newCode, extensions: commonExtensions.filter(Boolean) }));
  }, [originalCode, newCode, language, theme, getLanguageSupport, getThemeExtension]);

  return (
    <div className="relative my-4 text-sm border border-gray-300 dark:border-dark-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-2 text-center text-xs font-sans text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-slate-900/70">
            <div className="p-2 border-r border-gray-300 dark:border-dark-border">Your Code</div>
            <div className="p-2">AI Suggestion</div>
        </div>
        <div ref={editorRef} className="w-full h-96 [&>.cm-merge-container]:h-full [&>.cm-merge-container]:bg-white dark:[&>.cm-merge-container]:bg-dark-bg [&_.cm-changedLine]:bg-blue-100 dark:[&_.cm-changedLine]:bg-blue-900/40" />
    </div>
  );
};

const MarkdownResponse: React.FC<{ content: string; originalCode?: string; language?: Language; theme: Theme }> = ({ content, originalCode, language, theme }) => {
    const parts = useMemo(() => content.split(/(```(?:[a-zA-Z]*\n)?[\s\S]*?```)/g).filter(Boolean), [content]);
    let diffHasBeenRendered = false;

    return (
        <div className="prose prose-sm md:prose-base prose-slate dark:prose-invert max-w-none text-gray-800 dark:text-dark-text-primary w-full leading-relaxed">
            {parts.map((part, index) => {
                const isCodeBlock = part.startsWith('```');

                if (isCodeBlock && originalCode && language && !diffHasBeenRendered) {
                    diffHasBeenRendered = true;
                    const code = part.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
                    return <CodeComparison key={index} originalCode={originalCode} newCode={code} language={language} theme={theme}/>;
                }

                if (isCodeBlock) {
                    const lang = part.match(/^```([a-zA-Z]*)/)?.[1] || '';
                    const code = part.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
                    return <CodeBlock key={index} language={lang} code={code} theme={theme}/>;
                } else {
                    const formattedPart = part
                        .split(/(\*\*.*?\*\*)/g)
                        .map((text, i) => {
                            if (text.startsWith('**') && text.endsWith('**')) {
                                return <strong key={i}>{text.slice(2, -2)}</strong>;
                            }
                            if (text.trim().startsWith('* ') || text.trim().startsWith('- ')) {
                                return (
                                    <ul className="list-disc pl-5 my-2" key={i}>
                                        {text.trim().split('\n').map((item, j) => (
                                            (item.trim().startsWith('* ') || item.trim().startsWith('- ')) && <li key={j}>{item.trim().substring(2)}</li>
                                        ))}
                                    </ul>
                                );
                            }
                            return <span key={i}>{text}</span>;
                        });
                    return <div key={index} className="whitespace-pre-wrap my-2">{formattedPart}</div>;
                }
            })}
        </div>
    );
};

const CodeAssistant: React.FC<{ theme: Theme }> = ({ theme }) => {
    const [mode, setMode] = useState<AiMode>('ASSIST');
    const [language, setLanguage] = useState<Language>('JavaScript');
    const [code, setCode] = useState<string>('');
    const [userInput, setUserInput] = useState<string>('');
    const [response, setResponse] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [originalCodeForDiff, setOriginalCodeForDiff] = useState<string>('');

    const handleSubmit = useCallback(async () => {
        setIsLoading(true);
        setResponse('');
        setError(null);
        setOriginalCodeForDiff('');
        let result = '';
        let originalCode = '';
        try {
            switch (mode) {
                case 'ASSIST':
                    if (!code || !userInput) { setError("Please provide both code and a problem description."); setIsLoading(false); return; }
                    originalCode = code;
                    result = await analyzeCode(code, userInput, language);
                    break;
                case 'GENERATE':
                    if (!userInput) { setError("Please provide a description for the code to generate."); setIsLoading(false); return; }
                    result = await generateCode(userInput, language);
                    break;
                case 'DEBUG':
                    if (!code) { setError("Please provide code to debug."); setIsLoading(false); return; }
                    originalCode = code;
                    result = await debugAndExecuteCode(code, language);
                    break;
                case 'REFACTOR':
                    if (!code) { setError("Please provide code to refactor."); setIsLoading(false); return; }
                    originalCode = code;
                    result = await refactorCode(code, language);
                    break;
                case 'REVIEW':
                    if (!code) { setError("Please provide code to review."); setIsLoading(false); return; }
                    result = await reviewCode(code, language);
                    break;
                case 'GENERATE_DOCS':
                    if (!code) { setError("Please provide code to generate documentation for."); setIsLoading(false); return; }
                    result = await generateDocs(code, language);
                    break;
                case 'GENERATE_TESTS':
                    if (!code) { setError("Please provide code to generate tests for."); setIsLoading(false); return; }
                    result = await generateTests(code, language);
                    break;
                case 'ANALYZE_REPO':
                    if (!userInput) { setError("Please provide a public GitHub repository URL."); setIsLoading(false); return; }
                    const match = userInput.match(/github\.com\/([^\/]+)\/([^\/]+)/);
                    if (!match) { setError("Invalid GitHub repository URL. Use format: https://github.com/owner/repo"); setIsLoading(false); return; }
                    const [, owner, repo] = match;
                    try {
                        const readmeMetaResponse = await fetch(`https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, '')}/readme`);
                        if (!readmeMetaResponse.ok) throw new Error(`Failed to fetch repo metadata (status: ${readmeMetaResponse.status}). Check URL or API rate limits.`);
                        const readmeMeta = await readmeMetaResponse.json();
                        const readmeContentResponse = await fetch(readmeMeta.download_url);
                        if(!readmeContentResponse.ok) throw new Error("Failed to download README content.");
                        result = await analyzeRepo(await readmeContentResponse.text());
                    } catch(e: any) { setError(e.message); setIsLoading(false); return; }
                    break;
            }
            setOriginalCodeForDiff(originalCode);
            setResponse(result);
        } catch (e: any) {
            setError(e.message || "An unexpected error occurred.");
            setResponse('');
        } finally {
            setIsLoading(false);
        }
    }, [mode, code, userInput, language]);

    const ModeButton = ({ value, label, icon }: { value: AiMode; label: string; icon: React.ReactNode }) => (
        <button onClick={() => { setMode(value); setResponse(''); setCode(''); setUserInput(''); setError(null); setOriginalCodeForDiff(''); }}
            className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${ mode === value ? 'bg-brand-primary text-white shadow-lg' : 'bg-gray-200 dark:bg-dark-surface text-gray-600 dark:text-dark-text-secondary hover:bg-gray-300 dark:hover:bg-slate-700' }`}>
            {icon}
            <span className="hidden sm:inline">{label}</span>
        </button>
    );

    const renderInputFields = () => {
        const commonTextAreaClasses = "w-full p-4 bg-white dark:bg-dark-bg border border-gray-300 dark:border-dark-border rounded-lg focus:ring-2 focus:ring-brand-primary focus:outline-none resize-y text-sm";
        const commonInputClasses = "w-full px-4 py-3 bg-white dark:bg-dark-bg border border-gray-300 dark:border-dark-border rounded-lg focus:ring-2 focus:ring-brand-primary focus:outline-none text-sm";
        
        switch (mode) {
            case 'ASSIST':
                return (
                    <><div className="h-64 sm:flex-grow"><CodeEditor value={code} onChange={setCode} language={language} theme={theme} /></div>
                    <textarea value={userInput} onChange={(e) => setUserInput(e.target.value)} placeholder="Describe the issue..." className={`${commonTextAreaClasses} h-24`} /></>
                );
            case 'GENERATE':
                return <textarea value={userInput} onChange={(e) => setUserInput(e.target.value)} placeholder="Describe the code you want..." className={`${commonTextAreaClasses} h-full`} />;
            case 'DEBUG':
            case 'REFACTOR':
            case 'REVIEW':
            case 'GENERATE_DOCS':
            case 'GENERATE_TESTS':
                return <div className="w-full h-full"><CodeEditor value={code} onChange={setCode} language={language} theme={theme} /></div>;
            case 'ANALYZE_REPO':
                return <input type="url" value={userInput} onChange={(e) => setUserInput(e.target.value)} placeholder="Enter public GitHub repo URL" className={commonInputClasses} />
        }
    };
    
    const submitButtonTextAndIcon = useMemo(() => {
        switch (mode) {
            case 'ASSIST': return { text: 'Analyze Code', icon: <CodeIcon className="w-5 h-5" /> };
            case 'GENERATE': return { text: 'Generate Code', icon: <WandIcon className="w-5 h-5" /> };
            case 'DEBUG': return { text: 'Debug & Run', icon: <PlayIcon className="w-5 h-5" /> };
            case 'REFACTOR': return { text: 'Refactor Code', icon: <SparklesIcon className="w-5 h-5" /> };
            case 'REVIEW': return { text: 'Review Code', icon: <ChecklistIcon className="w-5 h-5" /> };
            case 'GENERATE_DOCS': return { text: 'Generate Docs', icon: <DocumentTextIcon className="w-5 h-5" /> };
            case 'GENERATE_TESTS': return { text: 'Generate Tests', icon: <BeakerIcon className="w-5 h-5" /> };
            case 'ANALYZE_REPO': return { text: 'Analyze Repo', icon: <GitHubIcon className="w-5 h-5" /> };
        }
    }, [mode]);

    return (
        <div className="container mx-auto p-4"><div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-8">
            <div className="flex flex-col space-y-4">
                <div className="flex flex-wrap justify-center gap-2 mb-2">
                    <ModeButton value="ASSIST" label="Assist" icon={<CodeIcon className="w-5 h-5" />} />
                    <ModeButton value="GENERATE" label="Generate" icon={<WandIcon className="w-5 h-5" />} />
                    <ModeButton value="DEBUG" label="Debug" icon={<BugIcon className="w-5 h-5" />} />
                    <ModeButton value="REFACTOR" label="Refactor" icon={<SparklesIcon className="w-5 h-5" />} />
                    <ModeButton value="REVIEW" label="Review" icon={<ChecklistIcon className="w-5 h-5" />} />
                    <ModeButton value="GENERATE_DOCS" label="Docs" icon={<DocumentTextIcon className="w-5 h-5" />} />
                    <ModeButton value="GENERATE_TESTS" label="Tests" icon={<BeakerIcon className="w-5 h-5" />} />
                    <ModeButton value="ANALYZE_REPO" label="Repo" icon={<GitHubIcon className="w-5 h-5" />} />
                </div>
                <div className="bg-white/80 dark:bg-dark-surface/50 backdrop-blur-sm p-4 rounded-xl shadow-lg flex flex-col flex-grow h-full min-h-[40rem]">
                    <div className="flex items-center space-x-4 mb-4">
                        <label htmlFor="language-select" className="font-medium text-sm text-gray-700 dark:text-dark-text-secondary">Language:</label>
                        <select id="language-select" value={language} onChange={(e) => setLanguage(e.target.value as Language)}
                            className="bg-white dark:bg-dark-bg border border-gray-300 dark:border-dark-border rounded-md px-3 py-2 focus:ring-2 focus:ring-brand-primary focus:outline-none text-sm">
                            {LANGUAGES.map(lang => <option key={lang} value={lang}>{lang}</option>)}
                        </select>
                    </div>
                    <div className="space-y-4 flex-grow flex flex-col">{renderInputFields()}</div>
                    {error && <div className="p-3 my-2 text-sm text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/60 rounded-md text-center" role="alert">{error}</div>}
                    <div className="flex justify-end pt-4 mt-auto">
                        <button onClick={handleSubmit} disabled={isLoading} className="flex items-center justify-center space-x-2 w-full sm:w-auto px-6 py-3 bg-brand-primary text-white font-semibold rounded-lg hover:bg-sky-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors duration-200 shadow-md">
                            {isLoading ? (<><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div><span>Processing...</span></>) : (<>{submitButtonTextAndIcon.icon}<span>{submitButtonTextAndIcon.text}</span></>)}
                        </button>
                    </div>
                </div>
            </div>
            <div className="mt-8 lg:mt-0">
                 <div className="bg-white/80 dark:bg-dark-surface/50 backdrop-blur-sm p-4 rounded-xl shadow-lg h-full min-h-[20rem] lg:min-h-0 flex flex-col sticky top-20">
                    <h2 className="text-lg font-semibold mb-4 text-gray-600 dark:text-dark-text-secondary flex-shrink-0">AI Response</h2>
                    <div className="flex-grow overflow-y-auto">
                        {isLoading ? ( <div className="flex items-center justify-center h-full"><LoadingSpinner /></div>) 
                        : response ? ( <MarkdownResponse content={response} originalCode={originalCodeForDiff} language={language} theme={theme}/>) 
                        : (<div className="flex items-center justify-center h-full text-center text-gray-500 dark:text-dark-text-secondary"><p>Your AI-generated response will appear here.</p></div>)}
                    </div>
                </div>
            </div>
        </div></div>
    );
};

// --- BUNDLED: App.tsx ---
const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
    setTheme(initialTheme);
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  }, []);

  const handleLogin = useCallback(() => setIsAuthenticated(true), []);
  const handleSignup = useCallback(() => setIsAuthenticated(true), []);
  const handleLogout = useCallback(() => setIsAuthenticated(false), []);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-dark-bg text-gray-800 dark:text-dark-text-primary font-sans">
      {isAuthenticated ? (
        <>
          <Header onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} />
          <main>
            <CodeAssistant theme={theme} />
          </main>
        </>
      ) : (
        <Auth onLogin={handleLogin} onSignup={handleSignup} />
      )}
    </div>
  );
};


// --- BUNDLED: Original index.tsx Mounting Logic ---
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);