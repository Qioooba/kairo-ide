export interface JavaMethodInfo {
  name: string;
  line: number;
  isMain: boolean;
  isTest: boolean;
  startLine: number;
  endLine: number;
}

export interface JavaClassInfo {
  packageName: string;
  className: string;
  methods: JavaMethodInfo[];
}

export interface RunJavaParams {
  projectRoot: string;
  filePath: string;
  className: string;
  packageName: string;
  line: number;
  debug: boolean;
  methodType: 'main' | 'test';
}

export interface RunJavaResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  buildDir?: string;
  classpath?: string;
  error?: string;
}

export const JAVA_RUN_COMMANDS = {
  RUN_MAIN: 'kairo.java.runMain',
  DEBUG_MAIN: 'kairo.java.debugMain',
  RUN_TEST: 'kairo.java.runTest',
  DEBUG_TEST: 'kairo.java.debugTest',
} as const;
