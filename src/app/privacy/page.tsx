import type { Metadata } from "next";
import { LegalSection, LegalShell } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy · BaseBoard",
  description: "Privacy policy for the BaseBoard pixel art canvas tool.",
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="June 2026">
      <p>
        BaseBoard is a pixel art utility tool — a web interface for drawing on a
        shared on-chain canvas of pixels on the Base network. This policy
        explains what information is and is not involved when you use it.
      </p>

      <LegalSection heading="We do not collect personal information">
        <p>
          BaseBoard does not ask for, collect, or store personal information. We
          do not request your name, email address, phone number, mailing
          address, or any other contact or identity details, and there is no
          account to create. We never take custody of your wallet, private keys,
          or funds.
        </p>
      </LegalSection>

      <LegalSection heading="Wallet connection">
        <p>
          To draw on the canvas you connect a self-custodial wallet. When
          connected, the interface can see your public wallet address and read
          public on-chain data in order to display the canvas and the pixels
          associated with your address. Your public address and your
          transactions are part of the public blockchain — they are recorded by
          the network itself, not by us, and are publicly visible to anyone.
        </p>
      </LegalSection>

      <LegalSection heading="On-chain data is public">
        <p>
          Any image or link you place on a pixel is written to a public smart
          contract and is therefore public and, in practice, permanent. Do not
          publish anything on the canvas that you would not want to be public.
        </p>
      </LegalSection>

      <LegalSection heading="Third-party infrastructure">
        <p>
          Using BaseBoard relies on third-party infrastructure that you connect
          to — such as your wallet provider, blockchain RPC nodes, and image
          hosting or IPFS gateways for any artwork you reference. Those services
          operate under their own privacy practices, which we do not control.
        </p>
      </LegalSection>

      <LegalSection heading="No selling of data">
        <p>
          Because we do not collect personal information, we have no personal
          data to sell, rent, or trade.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          We may update this policy from time to time. Continued use of the tool
          after an update means you accept the revised policy.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
