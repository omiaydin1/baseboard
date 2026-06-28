import type { Metadata } from "next";
import { LegalSection, LegalShell } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Terms of Use · BaseBoard",
  description: "Terms of use for the BaseBoard pixel art canvas tool.",
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Use" updated="June 2026">
      <p>
        BaseBoard is a pixel art utility tool — a web interface for drawing on
        and decorating a shared on-chain canvas of pixels on the Base network.
        These terms govern your use of that interface. By using BaseBoard you
        agree to them. If you do not agree, do not use the tool.
      </p>

      <LegalSection heading="What BaseBoard is">
        <p>
          BaseBoard is a creative canvas platform. It lets you claim pixels on a
          grid, place images on the pixels you control, and optionally pass
          control of those pixels to others, entirely through peer-to-peer
          on-chain transactions that you sign with your own wallet. BaseBoard is
          purely an interface to public smart contracts; it is not a financial
          product, exchange, broker, or investment platform of any kind.
        </p>
      </LegalSection>

      <LegalSection heading="No financial custody or fund management">
        <p>
          BaseBoard never takes custody of your funds, assets, wallet, or
          private keys, and never holds, manages, pools, or invests any funds on
          your behalf. All activity occurs directly between participants and the
          public smart contracts on the blockchain. You alone control your
          wallet and authorize every transaction.
        </p>
      </LegalSection>

      <LegalSection heading="No investment or returns">
        <p>
          BaseBoard makes no representation that claiming, holding, or
          transferring pixels will have, retain, or increase in any value.
          Nothing in this tool is investment, financial, legal, or tax advice,
          and nothing here is an offer, solicitation, or promise of any return,
          profit, yield, or outcome. Pixels are decorative canvas space, not a
          security or financial instrument. Use BaseBoard only as a creative
          tool.
        </p>
      </LegalSection>

      <LegalSection heading="Blockchain transactions are your responsibility">
        <p>
          All transactions are executed on a public blockchain and are
          irreversible once submitted. We have no ability to reverse, cancel,
          refund, or modify any transaction. You are solely responsible for the
          security of your wallet and keys, for verifying every transaction
          before you sign it, and for all network (gas) fees, which are set by
          the network and paid directly by you. We are not responsible or liable
          for any blockchain transaction, network fee, failed or stuck
          transaction, smart contract behavior, wallet compromise, lost keys, or
          any loss arising from your use of a blockchain or wallet.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>
          You are responsible for the content you place on the canvas. Do not
          upload or link to unlawful, infringing, or harmful content. We may be
          unable to remove content that has been committed to a public smart
          contract.
        </p>
      </LegalSection>

      <LegalSection heading="Provided “AS IS”">
        <p>
          BaseBoard is provided strictly on an “AS IS” and “AS AVAILABLE” basis,
          without warranties or conditions of any kind, whether express or
          implied, including any implied warranties of merchantability, fitness
          for a particular purpose, availability, or non-infringement. We do not
          warrant that the tool will be uninterrupted, error-free, or secure. To
          the maximum extent permitted by applicable law, we disclaim all
          liability for any damages arising out of or relating to your use of, or
          inability to use, BaseBoard.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          We may update these terms from time to time. Continued use of the tool
          after an update means you accept the revised terms.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
