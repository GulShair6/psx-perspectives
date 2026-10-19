export function numericalTokens(text: string): string[] {
  return text.match(/[+\-−]?\p{Nd}+(?:[.,]\p{Nd}+)*(?:[%٪])?/gu) || [];
}
