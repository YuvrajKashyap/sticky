import Link from "next/link";
export const metadata = { title: "About Sticky" };

export default function AboutPage() {
  return <>
    <h1>Sticky</h1>
    <p>A private task workspace at sticky.yuvrajkashyap.com, built and operated by Yuvraj Kashyap.</p>
    <p>Capture tasks, organize lists, add subtasks, plan due dates, and set recurring schedules. Sticky keeps your work together across your signed-in devices.</p>
    <h2>Your workspace, your connections</h2>
    <p>Access is limited to approved accounts. Sign in with Google or an email link to open your workspace. Google sign-in identifies your account; it does not automatically import Google Tasks or Calendar data.</p>
    <p>Optional Google connections let you work with Google Tasks and Calendar through separate views and tools. Transfers between Google and Sticky require an explicit action. Reminders and connected assistant tools are optional.</p>
    <p><Link href="/">Open Sticky</Link></p>
    <h2>Privacy and support</h2>
    <p>Read how information is handled in the <Link href="/privacy">privacy policy</Link> and review the <Link href="/terms">terms of use</Link>.</p>
    <p>Contact <a href="mailto:ykyuvrajkashyap@gmail.com">ykyuvrajkashyap@gmail.com</a> for access, support, or data requests.</p>
  </>;
}
