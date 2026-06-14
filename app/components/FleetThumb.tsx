"use client";

import React, { useState, useEffect } from "react";

interface FleetThumbProps {
  photos: string[];
  alt: string;
}

export function FleetThumb({ photos, alt }: FleetThumbProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  const hasPhotos = photos && photos.length > 0;
  const mainPhoto = hasPhotos ? photos[0] : "";

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen || !hasPhotos) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        setCurrentIndex((prev) => (prev + 1) % photos.length);
      } else if (e.key === "ArrowLeft") {
        setCurrentIndex((prev) => (prev - 1 + photos.length) % photos.length);
      } else if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, photos, hasPhotos]);

  if (!hasPhotos) return null;

  return (
    <>
      {/* Container with strict inline styles */}
      <div 
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCurrentIndex(0);
          setIsOpen(true);
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          width: "150px", // Beautiful larger size
          height: "112px", // aspect ratio 4:3
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          border: isHovered ? "2px solid var(--aqua)" : "1px solid var(--line)",
          borderRadius: "10px",
          background: "#ffffff",
          cursor: "pointer",
          boxShadow: isHovered ? "0 8px 24px rgba(6, 79, 88, 0.18)" : "none",
          transform: isHovered ? "scale(1.05)" : "scale(1)",
          transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
        }}
      >
        <img 
          src={mainPhoto} 
          alt={alt} 
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover", // Stretches vertical photos to fill container, cropping top/bottom to keep car centered and large!
            objectPosition: "center 50%", // Centers the car perfectly
            transition: "transform 0.25s ease",
            transform: isHovered ? "scale(1.03)" : "scale(1)"
          }}
        />
      </div>

      {isOpen && (
        <div 
          className="fleet-photo-modal-overlay"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(6, 32, 35, 0.95)",
            backdropFilter: "blur(10px)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
            cursor: "zoom-out",
            animation: "fleetFadeIn 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
          }}
        >
          <div 
            style={{ 
              position: "relative", 
              width: "100%",
              maxWidth: "960px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "24px 0"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Main Image Container */}
            <div 
              style={{
                position: "relative",
                width: "90%",
                maxWidth: "800px",
                height: "60vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <img 
                src={photos[currentIndex]} 
                alt={`${alt} - Photo ${currentIndex + 1}`} 
                style={{ 
                  maxWidth: "100%", 
                  maxHeight: "100%", 
                  borderRadius: "16px", 
                  boxShadow: "0 30px 80px rgba(0, 0, 0, 0.6)",
                  objectFit: "contain",
                  border: "2px solid rgba(255, 255, 255, 0.15)",
                  transition: "all 0.3s ease"
                }} 
              />

              {/* Navigation Arrows */}
              {photos.length > 1 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentIndex((prev) => (prev - 1 + photos.length) % photos.length);
                    }}
                    style={{
                      position: "absolute",
                      left: "-60px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      background: "rgba(255, 255, 255, 0.15)",
                      backdropFilter: "blur(4px)",
                      border: "1px solid rgba(255, 255, 255, 0.25)",
                      color: "white",
                      fontSize: "24px",
                      cursor: "pointer",
                      display: "grid",
                      placeItems: "center",
                      transition: "all 0.25s ease"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--sun)";
                      e.currentTarget.style.color = "#3a3300";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)";
                      e.currentTarget.style.color = "white";
                    }}
                  >
                    &#8249;
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentIndex((prev) => (prev + 1) % photos.length);
                    }}
                    style={{
                      position: "absolute",
                      right: "-60px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      background: "rgba(255, 255, 255, 0.15)",
                      backdropFilter: "blur(4px)",
                      border: "1px solid rgba(255, 255, 255, 0.25)",
                      color: "white",
                      fontSize: "24px",
                      cursor: "pointer",
                      display: "grid",
                      placeItems: "center",
                      transition: "all 0.25s ease"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--sun)";
                      e.currentTarget.style.color = "#3a3300";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)";
                      e.currentTarget.style.color = "white";
                    }}
                  >
                    &#8250;
                  </button>
                </>
              )}
            </div>

            {/* Label and Info */}
            <div style={{
              marginTop: "20px",
              color: "white",
              fontSize: "18px",
              fontWeight: 850,
              textShadow: "0 2px 4px rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              gap: "12px"
            }}>
              <span>{alt}</span>
              <span style={{ 
                fontSize: "13px", 
                background: "rgba(255,255,255,0.2)", 
                padding: "2px 10px", 
                borderRadius: "20px" 
              }}>
                {currentIndex + 1} / {photos.length}
              </span>
            </div>

            {/* Bottom Thumbnails Strip */}
            {photos.length > 1 && (
              <div 
                style={{
                  display: "flex",
                  gap: "10px",
                  marginTop: "24px",
                  padding: "10px",
                  background: "rgba(0, 0, 0, 0.3)",
                  borderRadius: "14px",
                  maxWidth: "90%",
                  overflowX: "auto"
                }}
              >
                {photos.map((photo, index) => (
                  <div
                    key={index}
                    onClick={() => setCurrentIndex(index)}
                    style={{
                      width: "64px",
                      height: "48px",
                      borderRadius: "6px",
                      overflow: "hidden",
                      cursor: "pointer",
                      border: index === currentIndex ? "2.5px solid var(--sun)" : "1.5px solid rgba(255, 255, 255, 0.3)",
                      transform: index === currentIndex ? "scale(1.08)" : "scale(1)",
                      transition: "all 0.2s ease"
                    }}
                  >
                    <img 
                      src={photo} 
                      alt="" 
                      style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Close button */}
            <button
              style={{
                position: "absolute",
                top: "0px",
                right: "24px",
                width: "44px",
                height: "44px",
                borderRadius: "50%",
                background: "rgba(255, 255, 255, 0.15)",
                backdropFilter: "blur(4px)",
                border: "1px solid rgba(255, 255, 255, 0.25)",
                color: "white",
                fontSize: "24px",
                fontWeight: "bold",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                transition: "all 0.2s ease"
              }}
              onClick={() => setIsOpen(false)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#e07171";
                e.currentTarget.style.borderColor = "#e07171";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.25)";
              }}
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </>
  );
}
