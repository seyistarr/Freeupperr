// Shared native/Plyr media operations used by Home and profile previews.
(function(){
 window.FreeUpperInlineVideo={
  play(video){video.dataset.shouldPlay='1';return Promise.resolve((video.plyr||video).play());},
  pause(video){video.dataset.shouldPlay='0';(video.plyr||video).pause();}
 };
})();
