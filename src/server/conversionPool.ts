type Task = () => Promise<void>;

class ConversionPool {
    private active = 0;
    private queue: Task[] = [];

    constructor(public readonly maxConcurrent: number) {}

    submit(task: Task): void {
        this.queue.push(task);
        this.pump();
    }

    private pump(): void {
        while (this.active < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift()!;
            this.active += 1;
            task().finally(() => {
                this.active -= 1;
                this.pump();
            });
        }
    }
}

// Cap simultaneous ffmpeg encodes so a zip with N files can't hammer the
// box; surplus work waits in a FIFO queue and starts as slots free up.
export const conversionPool = new ConversionPool(4);
