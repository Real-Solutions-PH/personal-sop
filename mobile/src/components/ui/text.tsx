import { cn } from "@/lib/utils";
import { Text as RNText, type TextProps } from "react-native";

export function Text({ className, ...props }: TextProps) {
	return (
		<RNText className={cn("text-base text-foreground", className)} {...props} />
	);
}
