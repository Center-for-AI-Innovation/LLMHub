import { motion } from 'framer-motion';

interface OverviewProps {
  isArtifactVisible: boolean;
}

export function Overview({ isArtifactVisible }: OverviewProps) {
  return (
    <motion.div 
      className="flex flex-col items-center justify-center min-h-[40vh] px-4"
      initial={{ opacity: 1 }}
      animate={{ 
        opacity: isArtifactVisible ? 0 : 1,
        transition: { duration: 0.2 }
      }}
    >
      <div className="max-w-lg text-center space-y-4">
        <h1 className="text-2xl font-bold">Welcome to LLM Hub</h1>
        <p className="text-muted-foreground">
          Select a model to start chatting or request a new model for your specific needs.
        </p>
      </div>
    </motion.div>
  );
}
