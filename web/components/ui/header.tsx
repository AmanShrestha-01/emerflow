"use client";

import { buttonVariants } from "@/components/ui/button";
import {
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { Menu, MoveRight, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/emer/logo";
import { SignInPanel } from "@/components/emer/sign-in-panel";
import { loadSession } from "@/lib/emer/session";

// Header1 (twblocks) with Emer Flow's pages. Links go through next/link; buttons use the project's Base UI button styles.
const navigationItems: {
    title: string;
    href?: string;
    description?: string;
    cta?: { label: string; href: string };
    items?: { title: string; href: string }[];
}[] = [
    {
        title: "Home",
        href: "/",
    },
    {
        title: "Hospital Swarm",
        description: "Eleven AI agents agree where every patient goes. The hospital rules check each move, and a person makes the big calls.",
        items: [
            { title: "Command board", href: "/board" },
            { title: "AI workflow", href: "/workflow" },
            { title: "Memory", href: "/memory" },
            { title: "How it works", href: "/overview" },
            { title: "Meet the agents", href: "/overview#agents" },
        ],
    },
    {
        title: "Crews & doctors",
        description: "The same live hospital, seen by the people around it: ambulance crews on the road and doctors checking records.",
        items: [
            { title: "EMS map", href: "/" },
            { title: "DeepChart records", href: "/doctor" },
            { title: "Log in", href: "/login" },
        ],
    },
];

// Re-read the session when a page logs in or out (lib/emer/session.ts fires "emerflow:session").
const onSession = (cb: () => void) => {
    window.addEventListener("emerflow:session", cb);
    return () => window.removeEventListener("emerflow:session", cb);
};

function Header1() {
    const [isOpen, setOpen] = useState(false);
    const path = usePathname();
    // The front page (EMS map) and a signed-out visitor get just the brand and Sign in; the rest lives inside, after login.
    const hasSession = useSyncExternalStore(onSession, () => !!loadSession(), () => false);
    const front = path === "/" || path.startsWith("/ems") || path.startsWith("/login");
    const signedIn = hasSession && !front;
    const isOn = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.split("?")[0].split("#")[0]) && !href.includes("#"));
    return (
        <header className="w-full z-40 fixed top-0 left-0 bg-background/75 backdrop-blur-xl border-b border-white/60">
            <div className="relative mx-auto min-h-20 w-[min(1400px,calc(100%-24px))] flex gap-4 lg:gap-8 flex-row items-center">
                <Link href="/" aria-label="EmerFlow home" className="shrink-0 rounded-md">
                    <Logo />
                </Link>
                {signedIn && <div className="justify-start items-center gap-4 lg:flex hidden flex-row">
                    <NavigationMenu className="flex justify-start items-start">
                        <NavigationMenuList className="flex justify-start gap-4 flex-row">
                            {navigationItems.map((item) => (
                                <NavigationMenuItem key={item.title}>
                                    {item.href ? (
                                        <>
                                            <NavigationMenuLink asChild>
                                                <Link href={item.href} className={cn(buttonVariants({ variant: "ghost" }), "h-9 px-4", isOn(item.href) && "bg-muted")}>
                                                    {item.title}
                                                </Link>
                                            </NavigationMenuLink>
                                        </>
                                    ) : (
                                        <>
                                            <NavigationMenuTrigger className="font-medium text-sm bg-transparent">
                                                {item.title}
                                            </NavigationMenuTrigger>
                                            <NavigationMenuContent className="!w-[450px] p-4">
                                                <div className="flex flex-col lg:grid grid-cols-2 gap-4">
                                                    <div className="flex flex-col h-full justify-between">
                                                        <div className="flex flex-col">
                                                            <p className="text-base font-semibold">{item.title}</p>
                                                            <p className="text-muted-foreground text-sm">
                                                                {item.description}
                                                            </p>
                                                        </div>
                                                        {item.cta && (
                                                            <NavigationMenuLink asChild>
                                                                <Link href={item.cta.href} className={cn(buttonVariants({ size: "sm" }), "mt-10 h-9")}>
                                                                    {item.cta.label}
                                                                </Link>
                                                            </NavigationMenuLink>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-col text-sm h-full justify-end">
                                                        {item.items?.map((subItem) => (
                                                            <NavigationMenuLink asChild key={subItem.title}>
                                                                <Link
                                                                    href={subItem.href}
                                                                    className="flex flex-row justify-between items-center hover:bg-muted py-2 px-4 rounded"
                                                                >
                                                                    <span>{subItem.title}</span>
                                                                    <MoveRight className="w-4 h-4 text-muted-foreground" />
                                                                </Link>
                                                            </NavigationMenuLink>
                                                        ))}
                                                    </div>
                                                </div>
                                            </NavigationMenuContent>
                                        </>
                                    )}
                                </NavigationMenuItem>
                            ))}
                        </NavigationMenuList>
                    </NavigationMenu>
                </div>}
                <div className="ml-auto flex justify-end gap-4">
                    {!signedIn && <SignInPanel className={cn(buttonVariants(), "h-10 px-4")} />}
                </div>
                {signedIn && <div className="flex w-12 shrink lg:hidden items-end justify-end">
                    <button
                        className={cn(buttonVariants({ variant: "ghost" }), "h-10 w-10")}
                        onClick={() => setOpen(!isOpen)}
                        aria-label={isOpen ? "Close menu" : "Open menu"}
                        aria-expanded={isOpen}
                    >
                        {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                    {isOpen && (
                        <div className="absolute top-20 border-t flex flex-col w-full right-0 bg-background shadow-lg py-4 px-4 container gap-8">
                            {navigationItems.map((item) => (
                                <div key={item.title}>
                                    <div className="flex flex-col gap-2">
                                        {item.href ? (
                                            <Link
                                                href={item.href}
                                                onClick={() => setOpen(false)}
                                                className="flex justify-between items-center"
                                            >
                                                <span className="text-lg">{item.title}</span>
                                                <MoveRight className="w-4 h-4 stroke-1 text-muted-foreground" />
                                            </Link>
                                        ) : (
                                            <p className="text-lg">{item.title}</p>
                                        )}
                                        {item.items &&
                                            item.items.map((subItem) => (
                                                <Link
                                                    key={subItem.title}
                                                    href={subItem.href}
                                                    onClick={() => setOpen(false)}
                                                    className="flex justify-between items-center"
                                                >
                                                    <span className="text-muted-foreground">
                                                        {subItem.title}
                                                    </span>
                                                    <MoveRight className="w-4 h-4 stroke-1" />
                                                </Link>
                                            ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>}
            </div>
        </header>
    );
}

export { Header1 };
