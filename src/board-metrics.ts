import { HEIGHT, WIDTH, type Cell } from './game';

export interface BoardMetrics {
  holes: number;
  maxHeight: number;
  aggregateHeight: number;
  bumpiness: number;
  columnHeights: number[];
}

/** Evaluate the settled board after completed rows have been removed. */
export function boardMetrics(board: Cell[][]): BoardMetrics {
  let holes = 0;
  const columnHeights = Array.from({ length: WIDTH }, (_, x) => {
    const top = board.findIndex((row) => row[x] !== null);
    if (top === -1) return 0;
    for (let y = top + 1; y < HEIGHT; y++) {
      if (board[y][x] === null) holes++;
    }
    return HEIGHT - top;
  });
  return {
    holes,
    maxHeight: Math.max(...columnHeights),
    aggregateHeight: columnHeights.reduce((sum, height) => sum + height, 0),
    bumpiness: columnHeights
      .slice(1)
      .reduce((sum, height, index) => sum + Math.abs(height - columnHeights[index]), 0),
    columnHeights,
  };
}
