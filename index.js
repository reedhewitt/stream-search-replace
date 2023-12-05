class Transformer {
  searchReplace = [];
  overflowLength = 0;
  adjustLength = 0;
  buffer = '';
  chunkLengths = [];
  
  constructor(searchReplace){
    this.searchReplace = searchReplace ?? [];
    
    this.shouldDoReplacements = !!this.searchReplace.length;
    
    if(this.shouldDoReplacements){
      for(let i = 0; i < this.searchReplace.length; i++){
        const searchTerm = this.searchReplace[i]?.search;
        if(searchTerm){
          this.overflowLength = Math.max(this.overflowLength, searchTerm.length);
        }
      }
      
      if(this.overflowLength > 1){
        this.overflowLength--;
      }
    }
  }
  
  replace(content){
    for(let i = 0; i < this.searchReplace.length; i++){
      const searchTerm = this.searchReplace[i]?.search;
      if(searchTerm){
        const replacement = this.searchReplace[i]?.replace ?? '';
        const termLength = searchTerm.length;
        const replacementLength = replacement.length;
        const adjustment = replacementLength - termLength;
        let index = 0;
        
        while(index > -1){
          // Get the first index of the search term.
          index = content.indexOf(searchTerm, index);
          
          if(index > -1){
            // The content before the search term, plus the replacement, plus the content after the search term.
            content = content.slice(0, index) + replacement + content.slice(index + termLength);
            
            // Adjust index to start after this replacement in the next loop.
            index = index + termLength + adjustment;
            
            // Update the cumulative adjustment amount.
            this.adjustLength += adjustment;
          }
        }
      }
    }
    
    return content;
  }
  
  transform(chunk, controller){
    if(!this.shouldDoReplacements || typeof chunk !== 'string'){
      // When no search/replace values were provided, enqueue the chunk without change.
      controller.enqueue(chunk);
    } else if(this.overflowLength === 0){
      // If the overflow length is zero, the search term must be a single character. Do the replacement without buffering.
      controller.enqueue(this.replace(chunk));
    } else {
      // All chunk lengths go into this array to keep track of them.
      this.chunkLengths.push(chunk.length);
      
      // Keep adding to the buffer until we have enough to do a boundary-safe replacement.
      if(this.buffer === ''){
        // First iteration, just buffer the chunk.
        this.buffer = chunk;
      } else {
        // Check if the buffer has grown enough to be boundary-safe.
        // Start by getting the buffer length before the current chunk is introduced.
        const startingLength = this.buffer.length;
        
        // The minimum workable length to be boundary-safe.
        const workableLength = startingLength + this.overflowLength;
        
        let remainder = '';
        
        // If the current chunk is larger than the overflow length, we only need part of it.
        // Save the remainder to add to the buffer later.
        if(chunk.length > this.overflowLength){
          this.buffer = this.buffer + chunk.slice(0, this.overflowLength);
          remainder = chunk.slice(this.overflowLength);
        } else {
          // If the current chunk is smaller than the overflow length, just add the whole thing.
          this.buffer = this.buffer + chunk;
        }
        
        // We are ready to do replacements if we were able to get an overflow length past the chunk boundary.
        if(this.buffer.length >= workableLength){
          // Do the replacement in the buffer.
          this.buffer = this.replace(this.buffer);
          
          // Figure out how much of the buffer we need to send. The content for the pending chunk may have
          // grown or shrunk based on replacements.
          const pendingLength = this.chunkLengths.shift() + this.adjustLength;
          
          // Reset the adjustment length.
          this.adjustLength = 0;
          
          // Enqueue from the buffer.
          controller.enqueue(this.buffer.slice(0, pendingLength));
          
          // The new buffer is the leftover part that was not enqueued, plus any remainder from the current chunk.
          this.buffer = this.buffer.slice(pendingLength) + remainder;
        }
      }
    }
  }
  
  flush(controller){
    if(this.buffer.length){
      controller.enqueue(this.replace(this.buffer));
      this.buffer = '';
      this.chunkLengths.length = 0;
    }
    
    controller.terminate();
  }
}

export default async function streamSearchReplace(stream, searchReplace = []){
  if(!searchReplace || !searchReplace.length) return stream;
  
  const transformer = new Transformer(searchReplace);
  
  const transformStream = new TransformStream(transformer);
  
  return stream.pipeThrough(transformStream);
}