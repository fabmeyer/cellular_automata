class RowMemory {
    constructor(settings) {
        this.items = [];
        this.hashes = [];
        this.zIndices = [];
        this.capacity = settings.memoryCapacity;
        this.rowLength = settings.grid.rows;
        this.matchRunLength = settings.matchRunLength;
        this.head = 0;
        this.matchIndices = [];
        this.matchHead = 0;
        this.latestMatchedPastZIndices = [];
        this.latestConsecutiveRun = [];
    }

    extractRowStates(grid, zIndex) {
        const rowStates = new Uint8Array(this.rowLength);
        for (let y = 0; y < this.rowLength; y++) {
            rowStates[y] = grid[0][y][zIndex].state;
        }
        return rowStates;
    }

    hashRow(rowStates) {
        let hash = 2166136261;
        for (const state of rowStates) {
            hash ^= state;
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    getLatestIndex(length, head) {
        return (head + length - 1) % length;
    }

    pushRingValue(buffer, head, value) {
        if (buffer.length < this.capacity) {
            buffer.push(value);
            return buffer.length % this.capacity;
        }
        buffer[head] = value;
        return (head + 1) % this.capacity;
    }

    getOrderedRing(buffer, head) {
        return buffer.length < this.capacity ? buffer.slice() : buffer.slice(head).concat(buffer.slice(0, head));
    }

    addLayer(grid, zIndex) {
        const rowStates = this.extractRowStates(grid, zIndex);
        const index = this.items.length < this.capacity ? this.items.length : this.head;
        this.items[index] = rowStates;
        this.hashes[index] = this.hashRow(rowStates);
        this.zIndices[index] = zIndex;
        this.head = this.items.length < this.capacity
            ? this.items.length % this.capacity : (this.head + 1) % this.capacity;
    }

    compareRows(rowA, rowB) {
        return rowA.every((state, index) => state === rowB[index]);
    }

    addMatch(zIndex) {
        this.matchHead = this.pushRingValue(this.matchIndices, this.matchHead, zIndex);
    }

    getOrderedMatches() {
        return this.getOrderedRing(this.matchIndices, this.matchHead);
    }

    getLatestConsecutiveMatchRun() {
        const matches = this.getOrderedMatches();
        if (matches.length === 0) {
            return [];
        }
        const run = [matches[matches.length - 1]];
        for (let i = matches.length - 2; i >= 0 && matches[i] + 1 === run[0]; i--) {
            run.unshift(matches[i]);
        }
        return run;
    }

    findMatchingPastZIndices(latestIndex) {
        const matches = [];
        for (let i = 0; i < this.items.length; i++) {
            if (i !== latestIndex && this.hashes[i] === this.hashes[latestIndex] &&
                this.compareRows(this.items[latestIndex], this.items[i])) {
                matches.push(this.zIndices[i]);
            }
        }
        return matches;
    }

    compareLatestRow() {
        if (this.items.length < 2) {
            this.latestMatchedPastZIndices = [];
            this.latestConsecutiveRun = [];
            return false;
        }
        const latestIndex = this.getLatestIndex(this.items.length, this.head);
        const latestZIndex = this.zIndices[latestIndex];
        const matches = this.findMatchingPastZIndices(latestIndex);
        this.latestMatchedPastZIndices = matches;
        if (matches.length === 0) {
            this.latestConsecutiveRun = [];
            return false;
        }
        console.log(`Match found for z=${latestZIndex} with past z-indices:`, matches,
            `hash=${this.hashes[latestIndex]}`);
        this.addMatch(latestZIndex);
        this.latestConsecutiveRun = this.getLatestConsecutiveMatchRun();
        if (this.latestConsecutiveRun.length > 1) {
            console.log("Consecutive matched z-indices:", this.latestConsecutiveRun);
        }
        if (this.latestConsecutiveRun.length >= this.matchRunLength) {
            console.log("Every z-index in the latest run has a matching past row:", this.latestConsecutiveRun);
            return true;
        }
        return false;
    }

    getLatestRow() {
        return this.items.length === 0 ? null : this.items[this.getLatestIndex(this.items.length, this.head)];
    }
}
