import { ThemeProvider as NextThemesProvider } from "next-themes";
import { ReactNode } from "react";

export const ThemeProvider = ({ children }: { children: ReactNode }) => (
  // Light by default, and NOT following the operating system.
  //
  // enableSystem would make the OS preference the real default, so a
  // resident whose phone is in dark mode would still land on a dark
  // site — which is the opposite of defaulting to light. The theme
  // toggle still works and still remembers a choice; this only decides
  // what somebody sees before they make one.
  <NextThemesProvider
    attribute="class"
    defaultTheme="light"
    enableSystem={false}
    disableTransitionOnChange
  >
    {children}
  </NextThemesProvider>
);